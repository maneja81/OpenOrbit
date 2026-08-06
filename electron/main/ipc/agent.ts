import { ipcMain, BrowserWindow, dialog } from "electron";
import {
  run,
  setTracingDisabled,
  Agent,
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
import { resolveApprovalsAndRun, MAX_TURNS_PER_RUN } from "../ai/runLoop";
import { createSerialQueue } from "../ai/serialQueue";
import { cancelPendingForTrace } from "../db/checklistStore";
import { guardLeakedChecklistReply, toolNamesOf } from "../ai/replyGuard";
import { guardFalseAgentMutationClaim, guardFalseAgentMutationClaimAtTopLevel } from "../ai/agentMutationGuard";
import { NO_ANSWER_TIMEOUT_SENTINEL, type RequestAnswerFn } from "../ai/tools/askUserTools";
import { createPausableDeadline } from "./pausableDeadline";
import { extractApprovalMeta, extractRunItemMeta } from "../ai/runItemMeta";
import { configureChatClient, estimateGenerationCost, providerIdForModel } from "../ai/provider";
import { insertTokenUsage, updateTokenUsageCost } from "../db/tokenUsageStore";
import { getRecentMessages, appendMessage, ChatMessageRecord } from "./chatHistory";
import { readAppSetting } from "../appSettings";
import { devLog } from "../devLog";
import { broadcastSettingsUpdate, broadcastConnectorsUpdate, broadcastTasksUpdate } from "../ai/broadcastEvents";
import { suggestAgentIdentity, AgentIdentitySuggestError } from "../ai/agentIdentitySuggest";

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

/** The orchestrator is the only agent given prior turns directly. A specialist it calls as a
 * tool (Cipher/Atlas/Explorer/Chrono/custom — see agentAsTool in ai/agents.ts) runs as a
 * fully independent nested `run()` and does NOT receive this history automatically — it
 * only sees the `input` string the orchestrator's own tool call supplies, which is why
 * orchestrator.md explicitly tells Orbit to pack self-contained context into every
 * specialist call. (This changed when handoffs were replaced with tool calls: a handoff used
 * to forward the full input history to the sub-agent automatically via the SDK's
 * HandoffInputData.inputHistory — that mechanism doesn't apply to a nested tool-call run.) */
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

// broadcastSettingsUpdate/broadcastConnectorsUpdate/broadcastTasksUpdate moved to
// ../ai/broadcastEvents.ts so update_setting (agents.ts) can call broadcastSettingsUpdate
// directly at the point of the write, rather than only once at the end of the whole run —
// see that module's header comment. Kept called unconditionally here too, once per run: it
// still covers any DB write a tool makes without an immediate call of its own, and is cheap.

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
      // A pinned agent carries its provider on the model object; an inherited one resolves to
      // the Chat slot. Without this, cost is priced against whatever Chat happens to be.
      const servingProviderId = providerIdForModel(agent?.model);
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

      estimateGenerationCost(
        generationId,
        model,
        response.usage.inputTokens,
        response.usage.outputTokens,
        servingProviderId
      )
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

const DEFAULT_AGENT_RUN_TIMEOUT_SECONDS = 3600;

/** Settings → General lets this be extended for runs expected to take longer (multi-hop
 * handoffs, slow MCP tools, web search) — re-read per run rather than cached so a change
 * takes effect on the next send without an app restart. */
function getAgentRunTimeoutMs(): number {
  const seconds = readAppSetting("agentRunTimeoutSeconds", DEFAULT_AGENT_RUN_TIMEOUT_SECONDS);
  return seconds * 1000;
}

/** How long an approval prompt waits for the user before giving up and rejecting the call.
 * Deliberately far longer than the run timeout — the run clock is paused while this one
 * runs, so the only thing it bounds is how long a forgotten dialog can pin a run open. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

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

/** Questions awaiting an answer from the renderer, keyed by a main-generated questionId.
 * Same shape and reasoning as pendingApprovals above, with one addition: `fallbackAnswer`
 * is precomputed once (the field's placeholder, or the fixed timeout sentinel if there
 * isn't one) so the timeout/abandonment paths don't need to re-derive it from the field —
 * they just resolve with it directly, same value askUser's own optional-and-skipped path
 * would produce. */
const pendingQuestions = new Map<
  string,
  {
    requestId: string;
    resolve: (answer: string) => void;
    timer: NodeJS.Timeout;
    sender: Electron.WebContents;
    fallbackAnswer: string;
  }
>();

function settleQuestion(questionId: string, answer: string, reason?: ApprovalSettledReason): void {
  const pending = pendingQuestions.get(questionId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingQuestions.delete(questionId);
  if (reason && !pending.sender.isDestroyed()) {
    pending.sender.send("agent:stream-question-settled", { questionId, reason });
  }
  pending.resolve(answer);
}

/** Resolves every question still outstanding for a run with its own fallback answer —
 * called when the run times out or fails, mirroring abandonApprovalsFor. */
function abandonQuestionsFor(requestId: string): void {
  for (const [questionId, pending] of pendingQuestions) {
    if (pending.requestId !== requestId) continue;
    settleQuestion(questionId, pending.fallbackAnswer, "abandoned");
  }
}

export function registerAgentHandlers() {
  // The non-streaming "agent:run" channel was unreachable from the renderer — no hook or
  // component called it, ChatInputBar/AgentsApp only ever use agent:runStream below — and
  // was removed as dead surface (KI-16) rather than left registered for a caller that never
  // arrived.

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
    async (
      event,
      input: string,
      requestId: string,
      targetAgentName?: string,
      persistInput = true
    ): Promise<string> => {
      if (typeof input !== "string" || input.length === 0) {
        throw new Error("agent:runStream requires non-empty text input");
      }
      if (typeof requestId !== "string" || requestId.length === 0) {
        throw new Error("agent:runStream requires a requestId");
      }
      configureChatClient();
      const history = getRecentMessages(undefined, getHistoryMessageLimit());
      // persistInput=false is for synthetic, caller-generated prompts (the onboarding
      // greeting) that must reach the model but never read back as something the user
      // actually typed — the assistant's reply below is still persisted either way.
      if (persistInput) appendMessage({ role: "user", text: input });
      // One id per run, generated here so the same value reaches all three places that
      // need to agree: token_usage's rows, the assistant message row, and the renderer.
      // Main-generated rather than reusing the renderer's requestId — requestId is
      // caller-supplied, and a repeat would silently merge two runs' costs.
      const traceId = randomUUID();
      // Sent before the run starts so the renderer can attach it to the turn even if the
      // run later fails: a partial turn that still burned tokens should still show a cost.
      event.sender.send("agent:stream-trace", { requestId, traceId });
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

      /** One card in front of the user at a time, across both mechanisms that produce one.
       * Parallel tool calls in a single turn, and parallel specialist runs each with their
       * own approval loop, both put more than one request in flight at once — see
       * ai/serialQueue.ts. Wrapping here (rather than inside each request function) keeps
       * the deadline paused across queued time too, so waiting your turn never costs the
       * run its budget. */
      const userPromptQueue = createSerialQueue();
      const askUserSerially = <T,>(request: () => Promise<T>): Promise<T> => {
        deadline.pause();
        return userPromptQueue.run(request).finally(() => deadline.resume());
      };

      /** Asks the user to approve one tool call and waits for their answer, with the run
       * clock paused for the duration. Resolves false on timeout or if the run is
       * abandoned, which the caller turns into a rejection the model is told about. */
      const requestApproval = (item: unknown): Promise<boolean> =>
        askUserSerially(() => {
        const approvalId = randomUUID();
        const meta = extractApprovalMeta(item);
        devLog(`[agent:runStream] requestId=${requestId} awaiting approval for tool=${meta.toolName ?? "(unknown)"}`);
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
        })
          .then((approved) => {
            devLog(
              `[agent:runStream] requestId=${requestId} approval ${approved ? "granted" : "declined"} for ${
                meta.toolName ?? "(unknown)"
              }`
            );
            return approved;
          });
        });

      /** Asks the user a real question via ask_user and waits for their answer, with the run
       * clock paused across the whole wait by requestAnswer below — same shape as
       * requestApproval, but resolves with the answer text itself rather than a boolean. On
       * timeout, resolves with the field's own placeholder if it has one, or the fixed
       * NO_ANSWER_TIMEOUT_SENTINEL otherwise, so the calling agent always gets a real string
       * back and can react instead of hanging. */
      const askOneQuestion: RequestAnswerFn = (agentName, question, field) => {
        const questionId = randomUUID();
        const fallbackAnswer = field.placeholder ?? NO_ANSWER_TIMEOUT_SENTINEL;
        devLog(`[agent:runStream] requestId=${requestId} awaiting answer from ${agentName} for question="${question}"`);
        return new Promise<string>((resolve) => {
          const timer = setTimeout(() => settleQuestion(questionId, fallbackAnswer, "timeout"), APPROVAL_TIMEOUT_MS);
          pendingQuestions.set(questionId, { requestId, resolve, timer, sender: event.sender, fallbackAnswer });
          event.sender.send("agent:stream-question", {
            requestId,
            questionId,
            agentName,
            question,
            field,
            // Same reasoning as requestApproval's expiresAt — an absolute deadline the
            // renderer counts down to, immune to IPC latency or a slow first render.
            expiresAt: Date.now() + APPROVAL_TIMEOUT_MS,
          });
        })
          .then((answer) => {
            devLog(`[agent:runStream] requestId=${requestId} answered: "${answer}"`);
            return answer;
          });
      };

      const requestAnswer: RequestAnswerFn = (agentName, question, field) =>
        askUserSerially(() => askOneQuestion(agentName, question, field));

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

      // Runs one agent (the orchestrator, or a specialist invoked as a tool) to completion,
      // resolving any approval interruptions along the way via the same requestApproval/
      // forwardStreamEvents this request already has — one round-trip to the renderer per
      // approval regardless of how deep the call is nested. Logged per segment, not once at
      // the end: a resumed run is a fresh result whose rawResponses covers only its own
      // segment, so logging after the loop would silently drop the cost of every model call
      // made before an approval pause. Same traceId throughout, so the rows still add up to
      // one turn even when a specialist tool call is what triggered the resume.
      const runToCompletion = (target: Agent, input: unknown, label: string) => {
        const runOnce = async (segmentInput: unknown) => {
          const segment = await run(target, segmentInput as Parameters<typeof run>[1], {
            stream: true,
            maxTurns: MAX_TURNS_PER_RUN,
          });
          await forwardStreamEvents(segment);
          await segment.completed;
          if (!timedOut) logTokenUsage(segment, traceId);
          return segment;
        };
        devLog(`[agent:runStream] requestId=${requestId} running ${label}`);
        return resolveApprovalsAndRun(runOnce, input, requestApproval, () => timedOut);
      };

      // Passed into buildOrchestrator so every specialist agent gets wrapped as a tool the
      // orchestrator can call directly — see ai/agents.ts's agentAsTool. A specialist run
      // this way is a fully independent nested run: it does not automatically see the prior
      // conversation the way a handoff used to forward it, only the `input` string the
      // orchestrator's tool call supplies (see orchestrator.md's updated guidance on
      // packaging context). Its own approval-gated tools (Cipher's update_agent, Chrono's
      // create_task, any agent's HTTP write) still pause for the same user-facing dialog —
      // that is the entire reason this shares runToCompletion with the top-level run rather
      // than using the SDK's own Agent.asTool(), which resolves nested interruptions nowhere.
      const runSubAgent = async (agent: Agent, subInput: string, displayName: string): Promise<string> => {
        const result = await runToCompletion(agent, subInput, `specialist=${displayName}`);
        const output = result?.finalOutput ?? "";
        const label = `requestId=${requestId} specialist=${displayName}`;
        // KI-23: a specialist (Cipher) can claim an agent was created/updated without
        // having actually called create_agent/update_agent in this same run — checked
        // before the checklist-leak guard since that one repairs *phrasing*, and a false
        // mutation claim needs replacing outright, not rewording.
        const checkedOutput = guardFalseAgentMutationClaim(output, result?.newItems ?? [], label);
        // KI-6: a specialist can leak its own write_checklist call the same way the
        // top-level run can — catch it here too, so Orbit's own reply never gets built on
        // top of raw JSON it received back from a specialist call.
        return guardLeakedChecklistReply(checkedOutput, subInput, agent.model, label, toolNamesOf(agent));
      };

      const { agent: orchestrator, mcpServers, allAgents } = await buildOrchestrator(runSubAgent, traceId, requestAnswer);
      // Deterministic routing (e.g. "/cipher <message>") bypasses the orchestrator's own
      // routing judgment entirely and runs the named agent directly — falls back to the
      // orchestrator if the name doesn't match (agent renamed/deleted between menu-open
      // and send), never surfacing an error to the user for that race.
      const runTarget =
        (typeof targetAgentName === "string" && targetAgentName.length > 0
          ? allAgents.find((a) => a.name.toLowerCase() === targetAgentName.toLowerCase())
          : undefined) ?? orchestrator;
      devLog(`[agent:runStream] requestId=${requestId} input="${input}" target=${runTarget.name}`);

      const runPromise = (async () => {
        try {
          const result = await runToCompletion(runTarget, buildInputWithHistory(history, input), "top-level run");
          if (!result) return "";

          broadcastSettingsUpdate();
          broadcastConnectorsUpdate();
          broadcastTasksUpdate();
          const rawFinalOutput = result.finalOutput ?? "";
          devLog(
            `[agent:runStream] requestId=${requestId} lastAgent=${result.lastAgent?.name ?? "none"} finalOutput="${rawFinalOutput}"`
          );
          const topLevelLabel = `requestId=${requestId} lastAgent=${result.lastAgent?.name ?? "none"}`;
          const runTargetToolNames = toolNamesOf(runTarget);
          // KI-23: a directed message (e.g. "/cipher ...") runs Cipher itself as runTarget,
          // not the orchestrator — in that case its own newItems are exactly where
          // create_agent/update_agent would appear, so check directly rather than via the
          // weaker "did it call cipher" proxy the orchestrator path uses below.
          const mutationChecked = runTargetToolNames.some((n) => n === "create_agent" || n === "update_agent")
            ? guardFalseAgentMutationClaim(rawFinalOutput, result.newItems, topLevelLabel)
            : guardFalseAgentMutationClaimAtTopLevel(rawFinalOutput, result.newItems, topLevelLabel);
          // KI-6/KI-1: gpt-4.1-mini sometimes reports write_checklist as its reply text
          // instead of calling the tool — pasting the argument JSON, or narrating the call
          // ("write_checklist completed"). Never show either to the user; repair it into a
          // real reply instead of a generic apology where possible.
          const finalOutput = await guardLeakedChecklistReply(
            mutationChecked,
            input,
            runTarget.model,
            topLevelLabel,
            runTargetToolNames
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

      // A PausableDeadline rather than a fixed-timer race because this run has to survive
      // an approval pause — see its class comment.
      return await Promise.race([runPromise, deadline.promise])
        .catch((err) => {
          timedOut = true;
          // A dialog waiting on a run that just died would otherwise hang until its own
          // 5-minute timeout.
          abandonApprovalsFor(requestId);
          // Same reasoning, for a question that never got answered.
          abandonQuestionsFor(requestId);
          // Same reasoning, for the checklist widget: a run that dies mid-plan must not
          // leave an item stuck showing "in progress" forever.
          cancelPendingForTrace(traceId);
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

  /** The renderer's answer to an agent:stream-question prompt. Same no-op-on-unknown-id
   * reasoning as agent:approveTool. `answer` may be empty only when the field wasn't
   * required — askUser's own execute() doesn't otherwise validate this, since a required
   * question with no answer is exactly what the UI's own Skip-button visibility is meant
   * to prevent, not something the IPC boundary needs to re-police. */
  ipcMain.handle("agent:answerQuestion", (_event, questionId: string, answer: string) => {
    if (typeof questionId !== "string" || questionId.length === 0) {
      throw new Error("agent:answerQuestion requires a non-empty questionId");
    }
    if (typeof answer !== "string") {
      throw new Error("agent:answerQuestion requires a string answer");
    }
    settleQuestion(questionId, answer);
  });

  ipcMain.handle("agent:list", () => listAgentsForDisplay());

  ipcMain.handle("agent:update", (_event, id: string, patch: AgentUpdatePatch) => {
    if (typeof id !== "string" || id.length === 0) {
      throw new Error("agent:update requires a non-empty agent id");
    }
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("agent:update requires a plain object patch");
    }
    const stringFields: (keyof AgentUpdatePatch)[] = ["name", "tagline", "description", "model", "prompt", "providerId"];
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
    // Shape only — whether the id names a provider this build knows is createAgent's call, the
    // same division agent:update uses.
    for (const field of ["icon", "tagline", "description", "model", "providerId", "prompt"] as const) {
      if (input[field] !== undefined && typeof input[field] !== "string") {
        throw new Error(`agent:create input.${field} must be a string`);
      }
    }
    return createAgent(input);
  });

  // Settings → Agents → Add Agent's "Suggest" action. A plain one-off completion, not a
  // chat turn — see agentIdentitySuggest.ts for why this never touches chat_history.
  ipcMain.handle("agent:suggestIdentity", async (_event, context: string) => {
    if (typeof context !== "string" || context.trim().length === 0) {
      throw new Error("agent:suggestIdentity requires a non-empty context string");
    }
    try {
      return await suggestAgentIdentity(context);
    } catch (err) {
      if (err instanceof AgentIdentitySuggestError) throw err;
      throw new Error("Couldn't reach the model to suggest a name — check your provider settings.");
    }
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
      const { name, icon, tagline, description, model, providerId, prompt } = entry as Partial<AgentExport>;
      if (typeof name !== "string" || name.trim().length === 0) {
        throw new Error("agent:importFromFile requires a non-empty name for every agent");
      }
      return {
        name,
        icon: typeof icon === "string" ? icon : "",
        tagline: typeof tagline === "string" ? tagline : "",
        description: typeof description === "string" ? description : "",
        model: typeof model === "string" ? model : "",
        // Absent in files written before per-agent providers; importAgent also drops any id this
        // build doesn't recognise.
        providerId: typeof providerId === "string" ? providerId : "",
        prompt: typeof prompt === "string" ? prompt : "",
      };
    });

    return inputs.map((input) => importAgent(input));
  });
}
