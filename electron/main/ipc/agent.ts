import { ipcMain, BrowserWindow, dialog } from "electron";
import {
  run,
  setTracingDisabled,
  AgentInputItem,
  RunAgentUpdatedStreamEvent,
  RunItemStreamEvent,
  RunRawModelStreamEvent,
  RunStreamEvent,
} from "@openai/agents";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import {
  buildOrchestrator,
  listAgentsForDisplay,
  updateAgent,
  createAgent,
  deleteAgent,
  exportAgent,
  exportAllAgents,
  importAgent,
  getOrchestratorPromptForEditing,
  AgentUpdatePatch,
  AgentCreateInput,
  AgentExport,
} from "../ai/agents";
import { closeMcpServers } from "../ai/mcp";
import { extractApprovalMeta, extractRunItemMeta } from "../ai/runItemMeta";
import { configureChatClient, estimateGenerationCost } from "../ai/provider";
import { insertTokenUsage, updateTokenUsageCost } from "../db/tokenUsageStore";
import { getRecentMessages, appendMessage, ChatMessageRecord } from "./chatHistory";
import { readAppSetting } from "../appSettings";
import { devLog } from "../devLog";

// Best-effort extraction of a tool call's name/arguments (tool_called) or its output
// (tool_output) from a RunItem — the SDK's item shape varies by item type (function call
// vs handoff vs message), so this ducks-types rather than importing every item subtype.
// Purely diagnostic: must never throw and never affect the actual run.
function describeRunItem(item: unknown): string {
  try {
    const anyItem = item as {
      rawItem?: { name?: string; arguments?: string };
      output?: unknown;
      agent?: { name?: string };
    };
    if (anyItem.output !== undefined) {
      return `output=${typeof anyItem.output === "string" ? anyItem.output : JSON.stringify(anyItem.output)}`;
    }
    if (anyItem.rawItem?.name) {
      return `tool="${anyItem.rawItem.name}" args=${anyItem.rawItem.arguments ?? "{}"}`;
    }
    return JSON.stringify(item).slice(0, 300);
  } catch {
    return "(unable to describe item)";
  }
}

const DEFAULT_HISTORY_MESSAGE_LIMIT = 20;

/** Settings → General controls how many prior messages get sent to the orchestrator as
 * context per run — a bigger window costs more tokens but keeps more of a long
 * conversation "in view". Re-read per run for the same reason as getAgentRunTimeoutMs. */
function getHistoryMessageLimit(): number {
  return readAppSetting("chatHistoryMessageLimit", DEFAULT_HISTORY_MESSAGE_LIMIT);
}

/** The orchestrator is the only agent given prior turns directly. When it hands off to a
 * sub-agent (ConfigAgent/KnowledgeAgent) within the same `run()` call, the SDK forwards
 * the full input history to the sub-agent automatically (see HandoffInputData.inputHistory
 * in @openai/agents-core) — so sub-agents don't need history threaded through separately. */
function buildInputWithHistory(history: ChatMessageRecord[], input: string): AgentInputItem[] {
  const historyItems: AgentInputItem[] = history.map((m) =>
    m.role === "assistant"
      ? { role: "assistant", status: "completed", content: [{ type: "output_text", text: m.text }] }
      : { role: "user", content: m.text }
  );
  return [...historyItems, { role: "user", content: input }];
}

export type { AgentRow, AgentDisplayRow } from "../ai/agents";

function broadcastTokenUsageUpdate(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("tokenUsage:update");
  }
}

// ConfigAgent's update_setting tool (electron/main/ai/agents.ts) writes straight to the
// settings table, bypassing the settings:update IPC handler entirely — without this,
// the renderer's cached settings state (fetched once in useSettings.ts) never learns a
// setting changed from inside an agent run, so the UI silently goes stale even though the
// agent correctly reports success. Broadcast unconditionally after every run rather than
// only when update_setting was actually called — cheap (one IPC message + a settings:get
// round trip) and far simpler than introspecting result.newItems for a specific tool call.
function broadcastSettingsUpdate(): void {
  devLog("[agent] broadcasting settings:update to all windows (settings may have changed this run)");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("settings:update");
  }
}

// ConfigAgent's connect_connector/disconnect_connector/attach_connector_to_agent/
// detach_connector_from_agent tools (electron/main/ai/agents.ts) write straight to the
// connectors/agents tables, bypassing the connectors:connect/disconnect IPC handlers
// entirely — without this, useConnectors.ts's cached state (fetched once on mount) never
// learns a connector changed mid agent-run. Same broadcast-unconditionally-after-every-run
// approach as broadcastSettingsUpdate above, for the same reason.
function broadcastConnectorsUpdate(): void {
  devLog("[agent] broadcasting connectors:update to all windows (connectors may have changed this run)");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("connectors:update");
  }
}

// Chrono's create_task/update_task/complete_task/cancel_task/delete_task tools
// (electron/main/ai/tools/taskAgentTools.ts) write straight to the tasks table, bypassing
// the tasks:* IPC handlers entirely — same reasoning as broadcastSettingsUpdate/
// broadcastConnectorsUpdate above, so useTasks.ts's cached state doesn't go stale after a
// chat conversation with Chrono.
function broadcastTasksUpdate(): void {
  devLog("[agent] broadcasting tasks:update to all windows (tasks may have changed this run)");
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("tasks:update");
  }
}

// Structural subset of RunResult/StreamedRunResult shared via RunResultBase — kept minimal
// (rather than importing the concrete generic types) since the two result classes aren't
// exposed under a single common exported type.
interface RunResultLike {
  newItems: unknown[];
  rawResponses: { usage: { inputTokens: number; outputTokens: number; totalTokens: number }; responseId?: string }[];
  lastAgent?: { name: string; model: string | { toString(): string } };
}

// Logs one row per underlying LLM call in this run (a run spans multiple calls when the
// orchestrator hands off to a sub-agent using a different model). rawResponses has one entry
// per model call; newItems carries the agent active for each turn, so we walk newItems to
// find the ordered sequence of turn-agents and zip it against rawResponses by index. Falls
// back to attributing everything to lastAgent if the two don't line up 1:1 (e.g. future SDK
// behavior we haven't seen) — logging must never throw and break the actual chat response.
function logTokenUsage(result: RunResultLike, traceId: string): void {
  try {
    const turnAgents: { name: string; model: string | { toString(): string } }[] = [];
    let lastSeenAgentName: string | null = null;
    for (const item of result.newItems) {
      const agent = (item as { agent?: { name: string; model: string | { toString(): string } } }).agent;
      if (agent && agent.name !== lastSeenAgentName) {
        turnAgents.push(agent);
        lastSeenAgentName = agent.name;
      }
    }

    const rawResponses = result.rawResponses;
    const fallbackAgent = result.lastAgent;

    rawResponses.forEach((response, index) => {
      const agent = turnAgents.length === rawResponses.length ? turnAgents[index] : fallbackAgent;
      const agentId = agent?.name ?? null;
      const model = agent?.model ? String(agent.model) : "unknown";
      const generationId = response.responseId ?? null;

      const id = insertTokenUsage({
        agentId,
        model,
        traceId,
        inputTokens: response.usage.inputTokens,
        outputTokens: response.usage.outputTokens,
        totalTokens: response.usage.totalTokens,
        generationId,
      });
      broadcastTokenUsageUpdate();

      estimateGenerationCost(generationId, model, response.usage.inputTokens, response.usage.outputTokens)
        .then((costUsd) => {
          if (costUsd !== null) {
            updateTokenUsageCost(id, costUsd);
            broadcastTokenUsageUpdate();
          }
        })
        .catch(() => {});
    });
  } catch {
    // Token-usage logging must never break the underlying chat response.
  }
}

// Tracing exports to OpenAI's own dashboard by default, which needs an OPENAI_API_KEY
// env var we don't have (and don't want — we're on OpenRouter, not OpenAI directly).
// Without this, every run logs a harmless but noisy "No API key provided for OpenAI
// tracing exporter" warning. tracingDisabled isn't a per-run() option (only available
// via a Runner instance's RunConfig); this global toggle is the simpler fit here.
setTracingDisabled(true);

const DEFAULT_AGENT_RUN_TIMEOUT_SECONDS = 60;

/** Settings → General lets this be extended for runs expected to take longer (multi-hop
 * handoffs, slow MCP tools, web search) — re-read per run rather than cached so a change
 * takes effect on the next send without an app restart. */
function getAgentRunTimeoutMs(): number {
  const seconds = readAppSetting("agentRunTimeoutSeconds", DEFAULT_AGENT_RUN_TIMEOUT_SECONDS);
  return seconds * 1000;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

/** How long an approval prompt waits for the user before giving up and rejecting the call.
 * Deliberately far longer than the run timeout — the run clock is paused while this one
 * runs, so the only thing it bounds is how long a forgotten dialog can pin a run open. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * A run deadline that can be paused.
 *
 * `withTimeout` races a fixed timer, which is right when the only thing that can be slow
 * is the model — but a tool that needs the user's approval blocks on a human, and a human
 * will routinely take longer than the 60s default. Without pausing, enabling the
 * confirmation gate on any tool would make that tool's runs time out almost every time.
 *
 * Only *waiting on a person* pauses the clock. Model latency, tool execution, and network
 * time all still count against it, so a genuinely stuck run still dies on schedule.
 */
function createPausableDeadline(ms: number, message: string) {
  let remaining = ms;
  let startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let rejectFn: ((error: Error) => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });
  // The rejection is always consumed by the Promise.race below; this keeps a pause/resume
  // cycle from tripping an unhandled-rejection warning in the window before the race runs.
  promise.catch(() => {});

  const arm = () => {
    startedAt = Date.now();
    timer = setTimeout(() => rejectFn?.(new Error(message)), remaining);
  };
  arm();

  return {
    promise,
    pause() {
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    },
    resume() {
      if (timer) return;
      arm();
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Why an approval was resolved by something other than the user answering it. */
export type ApprovalSettledReason = "timeout" | "abandoned";

/** Approvals awaiting a decision from the renderer, keyed by a main-generated approvalId.
 * Main-generated rather than reusing the SDK's callId so a renderer reply can only ever
 * resolve an approval this process actually asked for.
 *
 * `sender` is held so the two paths that settle an approval *without* the user — the 5-minute
 * timeout and run abandonment — can say so. Without that the prompt stayed on screen with the
 * call already declined, and Approve became a silent no-op via the `!pending` guard below. */
const pendingApprovals = new Map<
  string,
  {
    requestId: string;
    resolve: (approved: boolean) => void;
    timer: NodeJS.Timeout;
    sender: Electron.WebContents;
  }
>();

function settleApproval(approvalId: string, approved: boolean, reason?: ApprovalSettledReason): void {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  // Only when something other than the user decided. A renderer that answered already knows,
  // and telling it again would race its own queue removal. `isDestroyed` because a window
  // closed mid-run is exactly when abandonment fires.
  if (reason && !pending.sender.isDestroyed()) {
    pending.sender.send("agent:stream-approval-settled", { approvalId, reason });
  }
  pending.resolve(approved);
}

/** Rejects every approval still outstanding for a run — called when the run times out or
 * fails, so a dialog can't sit waiting on a run that no longer exists. */
function abandonApprovalsFor(requestId: string): void {
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.requestId !== requestId) continue;
    settleApproval(approvalId, false, "abandoned");
  }
}

export function registerAgentHandlers() {
  // Non-streaming variant — currently unreachable from the renderer (ChatInputBar/AgentsApp
  // only ever call agent.runStream). Kept registered for any future non-streaming caller;
  // if it stays unused, consider removing rather than letting it drift out of sync with
  // agent:runStream's logic (timeout handling, etc).
  ipcMain.handle("agent:run", async (_event, input: string): Promise<string> => {
    if (typeof input !== "string" || input.length === 0) {
      throw new Error("agent:run requires non-empty text input");
    }
    configureChatClient();
    const history = getRecentMessages(undefined, getHistoryMessageLimit());
    appendMessage({ role: "user", text: input });
    // Generated up-front rather than at the logTokenUsage call so the same id can be
    // stamped on the assistant message below — that shared value is the only thing
    // linking a message to what it cost.
    const traceId = randomUUID();
    const { agent: orchestrator, mcpServers } = await buildOrchestrator();
    devLog(`[agent:run] input="${input}"`);
    try {
      const timeoutMs = getAgentRunTimeoutMs();
      const result = await withTimeout(
        run(orchestrator, buildInputWithHistory(history, input)),
        timeoutMs,
        `Agent run timed out after ${timeoutMs / 1000}s`
      );
      for (const item of result.newItems) {
        devLog(`[agent:run] item=${describeRunItem(item)}`);
      }
      logTokenUsage(result, traceId);
      broadcastSettingsUpdate();
      broadcastConnectorsUpdate();
      broadcastTasksUpdate();
      const finalOutput = result.finalOutput ?? "";
      devLog(`[agent:run] lastAgent=${result.lastAgent?.name ?? "none"} finalOutput="${finalOutput}"`);
      appendMessage({
        role: "assistant",
        text: finalOutput || "(no response)",
        agentId: result.lastAgent?.name ?? null,
        traceId,
      });
      return finalOutput;
    } finally {
      await closeMcpServers(mcpServers);
    }
  });

  // Streaming variant: sends incremental text deltas over "agent:stream-chunk" and
  // structural events over "agent:stream-agent" (handoff) / "agent:stream-step" (tool
  // calls, handoff events) — all tagged with requestId so overlapping runs don't
  // cross-talk. StreamedRunResult exposes a single underlying ReadableStream: both
  // its AsyncIterator and toTextStream() read from that same stream, and a
  // ReadableStream only supports one active reader — consuming both concurrently
  // throws "ReadableStream is locked". So we consume the AsyncIterator once and
  // derive text deltas from raw_model_stream_event/output_text_delta ourselves,
  // the same filter toTextStream() applies internally.
  ipcMain.handle(
    "agent:runStream",
    async (event, input: string, requestId: string, targetAgentName?: string): Promise<string> => {
      if (typeof input !== "string" || input.length === 0) {
        throw new Error("agent:runStream requires non-empty text input");
      }
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new Error("agent:runStream requires a requestId");
      }
      configureChatClient();
      const history = getRecentMessages(undefined, getHistoryMessageLimit());
      appendMessage({ role: "user", text: input });
      // One id per run, generated here so the same value reaches all three places that
      // need to agree: token_usage's rows, the assistant message row, and the renderer.
      // Main-generated rather than reusing the renderer's requestId — requestId is
      // caller-supplied, and a repeat would silently merge two runs' costs.
      const traceId = randomUUID();
      // Sent before the run starts so the renderer can attach it to the turn even if the
      // run later fails: a partial turn that still burned tokens should still show a cost.
      event.sender.send("agent:stream-trace", { requestId, traceId });
      const { agent: orchestrator, mcpServers, allAgents } = await buildOrchestrator();
      // Deterministic routing (e.g. "/cipher <message>") bypasses the orchestrator's own
      // handoff judgment entirely and runs the named agent directly — falls back to the
      // orchestrator if the name doesn't match (agent renamed/deleted between menu-open
      // and send), never surfacing an error to the user for that race.
      const runTarget =
        (typeof targetAgentName === "string" && targetAgentName.length > 0
          ? allAgents.find((a) => a.name.toLowerCase() === targetAgentName.toLowerCase())
          : undefined) ?? orchestrator;
      devLog(`[agent:runStream] requestId=${requestId} input="${input}" target=${runTarget.name}`);
      // The timeout only races the promise returned to the caller — it can't cancel the
      // SDK's own run() once started. If we closed MCP servers / logged / appended messages
      // in an outer `finally` keyed to the race, a timed-out run would still be consuming
      // the stream in the background against connections we just tore down, and would then
      // double-log token usage / double-append the assistant message once it eventually
      // settles. Instead `timedOut` lets the background run notice it lost the race and
      // skip all of that, closing MCP servers itself exactly once when it actually stops.
      let timedOut = false;
      const timeoutMs = getAgentRunTimeoutMs();
      const deadline = createPausableDeadline(timeoutMs, `Agent run timed out after ${timeoutMs / 1000}s`);

      /** Asks the user to approve one tool call and waits for their answer, with the run
       * clock paused for the duration. Resolves false on timeout or if the run is
       * abandoned, which the caller turns into a rejection the model is told about. */
      const requestApproval = (item: unknown): Promise<boolean> => {
        const approvalId = randomUUID();
        const meta = extractApprovalMeta(item);
        devLog(`[agent:runStream] requestId=${requestId} awaiting approval for tool=${meta.toolName ?? "(unknown)"}`);
        deadline.pause();
        return new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => settleApproval(approvalId, false, "timeout"), APPROVAL_TIMEOUT_MS);
          pendingApprovals.set(approvalId, { requestId, resolve, timer, sender: event.sender });
          event.sender.send("agent:stream-approval", {
            requestId,
            approvalId,
            toolName: meta.toolName ?? "",
            agentName: meta.agentName,
            args: meta.args,
            // Absolute deadline rather than a duration: the renderer counts down to a fixed
            // point, so neither IPC latency nor a slow first render shifts it. Sending it at
            // all is what stops the countdown copy from hardcoding a number that
            // APPROVAL_TIMEOUT_MS can silently drift away from.
            expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
          });
        }).finally(() => {
          // Resumed here rather than at each call site so an approval that times out or is
          // abandoned still restarts the clock exactly once.
          deadline.resume();
        });
      };

      /** Forwards one run segment's stream events to the renderer. Called once per segment:
       * a run interrupted for approval resumes as a new streamed result, and its events
       * have to reach the same subscriptions. */
      const forwardStreamEvents = async (segment: AsyncIterable<RunStreamEvent>): Promise<void> => {
        for await (const ev of segment) {
          if (timedOut) break;
          if (ev.type === "raw_model_stream_event") {
            const e = ev as RunRawModelStreamEvent;
            if (e.data.type === "output_text_delta") {
              event.sender.send("agent:stream-chunk", { requestId, chunk: e.data.delta });
            }
          } else if (ev.type === "agent_updated_stream_event") {
            const e = ev as RunAgentUpdatedStreamEvent;
            devLog(`[agent:runStream] requestId=${requestId} agent_updated -> ${e.agent.name}`);
            event.sender.send("agent:stream-agent", { requestId, agentName: e.agent.name });
          } else if (ev.type === "run_item_stream_event") {
            const e = ev as RunItemStreamEvent;
            // This is the single most useful line for diagnosing "the agent said it did
            // something but didn't" — it's the ground truth of every handoff/tool call/
            // tool output the SDK actually executed, independent of what the model claimed.
            devLog(`[agent:runStream] requestId=${requestId} item=${e.name} ${describeRunItem(e.item)}`);
            // Map SDK event names to human-readable labels for the step feed UI.
            // handoff_occurred is deliberately absent — the renderer's separate
            // "agent:stream-agent" subscription (fired from agent_updated_stream_event)
            // already logs that same handoff with the target agent's name attached
            // (see AgentsApp.tsx); emitting it here too produced a duplicate entry.
            const labelMap: Partial<Record<typeof e.name, string>> = {
              handoff_requested: "Handing off…",
              tool_called: "Calling tool…",
              tool_output: "Tool responded",
              reasoning_item_created: "Reasoning…",
              tool_approval_requested: "Awaiting approval…",
            };
            const label = labelMap[e.name];
            if (label) {
              // The renderer derives the activity feed from these events alone — never from
              // what the model says it did — so the real tool/agent names ride along and the
              // static label above stays only as the fallback when extraction finds nothing.
              // `at` is stamped on arrival here, so any duration built from it measures
              // observed latency rather than server-side execution time.
              event.sender.send("agent:stream-step", {
                requestId,
                type: e.name,
                label,
                at: Date.now(),
                ...extractRunItemMeta(e.item),
              });
            }
          }
        }
      };

      const runPromise = (async () => {
        try {
          let result = await run(runTarget, buildInputWithHistory(history, input), { stream: true });

          // Loops only when a tool needs the user's approval; a run with no
          // confirmation-gated tools goes round exactly once, as it always did.
          for (;;) {
            await forwardStreamEvents(result);
            await result.completed;
            if (timedOut) return "";

            // Logged per segment, not once at the end. A resumed run is a fresh result whose
            // rawResponses covers only its own segment — logging after the loop would silently
            // drop the cost of every model call made before the approval pause. Same traceId
            // throughout, so the rows still add up to one turn.
            logTokenUsage(result, traceId);

            const interruptions = result.interruptions ?? [];
            if (interruptions.length === 0) break;

            // SDK-native human-in-the-loop: a tool declaring needsApproval stops the run
            // here, before it executes, and only runs once approved. See ai/httpTools.ts.
            for (const interruption of interruptions) {
              const approved = await requestApproval(interruption);
              if (timedOut) return "";
              if (approved) {
                result.state.approve(interruption);
              } else {
                result.state.reject(interruption, { message: "The user declined this call." });
              }
              devLog(
                `[agent:runStream] requestId=${requestId} approval ${approved ? "granted" : "declined"} for ${
                  extractApprovalMeta(interruption).toolName ?? "(unknown)"
                }`
              );
            }
            result = await run(runTarget, result.state, { stream: true });
          }

          broadcastSettingsUpdate();
          broadcastConnectorsUpdate();
          broadcastTasksUpdate();
          const finalOutput = result.finalOutput ?? "";
          devLog(
            `[agent:runStream] requestId=${requestId} lastAgent=${result.lastAgent?.name ?? "none"} finalOutput="${finalOutput}"`
          );
          appendMessage({
            role: "assistant",
            text: finalOutput || "(no response)",
            agentId: result.lastAgent?.name ?? null,
            traceId,
          });
          return finalOutput;
        } finally {
          await closeMcpServers(mcpServers);
        }
      })();

      // The deadline replaces withTimeout for this handler because it has to survive an
      // approval pause; withTimeout stays in use by agent:run, which has no approval path.
      return await Promise.race([runPromise, deadline.promise])
        .catch((err) => {
          timedOut = true;
          // A dialog waiting on a run that just died would otherwise hang until its own
          // 5-minute timeout.
          abandonApprovalsFor(requestId);
          throw err;
        })
        .finally(() => deadline.clear());
    }
  );

  /** The renderer's answer to an agent:stream-approval prompt. An unknown or already-settled
   * approvalId is a no-op rather than an error — a double-click on Approve, or a reply that
   * lands after the prompt timed out, must not surface a failure to the user. */
  ipcMain.handle("agent:approveTool", (_event, approvalId: string, approved: boolean) => {
    if (typeof approvalId !== "string" || approvalId.length === 0) {
      throw new Error("agent:approveTool requires a non-empty approvalId");
    }
    if (typeof approved !== "boolean") {
      throw new Error("agent:approveTool requires a boolean approved flag");
    }
    settleApproval(approvalId, approved);
  });

  ipcMain.handle("agent:list", () => listAgentsForDisplay());

  ipcMain.handle("agent:update", (_event, id: string, patch: AgentUpdatePatch) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("agent:update requires a non-empty agent id");
    }
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("agent:update requires a plain object patch");
    }
    const stringFields: (keyof AgentUpdatePatch)[] = ["name", "tagline", "description", "model", "prompt"];
    for (const field of stringFields) {
      if (patch[field] !== undefined && typeof patch[field] !== "string") {
        throw new Error(`agent:update patch.${field} must be a string`);
      }
    }
    if (patch.enabled !== undefined && typeof patch.enabled !== "boolean") {
      throw new Error("agent:update patch.enabled must be a boolean");
    }
    if (patch.mcpServerIds !== undefined) {
      if (!Array.isArray(patch.mcpServerIds) || patch.mcpServerIds.some((v) => typeof v !== "string")) {
        throw new Error("agent:update patch.mcpServerIds must be an array of strings");
      }
    }
    if (patch.connectorIds !== undefined) {
      if (!Array.isArray(patch.connectorIds) || patch.connectorIds.some((v) => typeof v !== "string")) {
        throw new Error("agent:update patch.connectorIds must be an array of strings");
      }
    }
    if (patch.httpToolCollectionIds !== undefined) {
      if (
        !Array.isArray(patch.httpToolCollectionIds) ||
        patch.httpToolCollectionIds.some((v) => typeof v !== "string")
      ) {
        throw new Error("agent:update patch.httpToolCollectionIds must be an array of strings");
      }
    }
    return updateAgent(id, patch);
  });

  ipcMain.handle("agent:create", (_event, input: AgentCreateInput) => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new Error("agent:create requires a plain object input");
    }
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      throw new Error("agent:create requires a non-empty name");
    }
    return createAgent(input);
  });

  ipcMain.handle("agent:orchestratorPrompt", (): string => getOrchestratorPromptForEditing());

  ipcMain.handle("agent:delete", (_event, id: string) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("agent:delete requires a non-empty agent id");
    }
    deleteAgent(id);
  });

  // ids undefined/omitted exports every custom agent as one array file; a single id
  // exports just that agent as a plain object file; multiple ids export just those
  // agents as an array file — mirrors exportAgent/exportAllAgents. Handled explicitly
  // (rather than falling through to "export all" for any non-single-id case) so a
  // multi-id call can never silently export more than what was asked for.
  ipcMain.handle("agent:exportToFile", async (event, ids?: string[]): Promise<{ canceled: boolean }> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { canceled: true };

    const isSingle = Array.isArray(ids) && ids.length === 1;
    let payload: AgentExport | { agents: AgentExport[] };
    if (isSingle) {
      payload = exportAgent(ids[0]);
    } else if (Array.isArray(ids) && ids.length > 1) {
      payload = { agents: ids.map((id) => exportAgent(id)) };
    } else {
      payload = { agents: exportAllAgents() };
    }
    const defaultPath = isSingle ? `${(payload as AgentExport).name || "agent"}.json` : "agents.json";

    const result = await dialog.showSaveDialog(win, {
      defaultPath,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };

    await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), "utf-8");
    return { canceled: false };
  });

  ipcMain.handle("agent:importFromFile", async (event): Promise<import("../ai/agents").AgentRow[]> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return [];

    const result = await dialog.showOpenDialog(win, {
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return [];

    const raw = await fs.readFile(result.filePaths[0], "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }

    const candidates: unknown[] =
      parsed && typeof parsed === "object" && Array.isArray((parsed as { agents?: unknown }).agents)
        ? (parsed as { agents: unknown[] }).agents
        : [parsed];

    const inputs: AgentExport[] = candidates.map((entry) => {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        throw new Error("agent:importFromFile requires a plain object entry");
      }
      const { name, icon, tagline, description, model, prompt } = entry as Partial<AgentExport>;
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("agent:importFromFile requires a non-empty name for every agent");
      }
      return {
        name,
        icon: typeof icon === "string" ? icon : "",
        tagline: typeof tagline === "string" ? tagline : "",
        description: typeof description === "string" ? description : "",
        model: typeof model === "string" ? model : "",
        prompt: typeof prompt === "string" ? prompt : "",
      };
    });

    return inputs.map((input) => importAgent(input));
  });
}
