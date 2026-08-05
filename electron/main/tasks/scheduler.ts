/**
 * Task Manager scheduler: polls the `tasks` table (see db/tasksStore.ts) for due rows and
 * acts on them — firing an OS notification for a plain reminder, or running `prompt`
 * headlessly through an agent and notifying with the result. Only runs while the app
 * process is alive (same limitation as ai/webSearchDaemon.ts's child process — no
 * OS-level launchd/Task Scheduler integration), started/stopped from main/index.ts
 * alongside the explorer daemon.
 */

import { randomUUID } from "node:crypto";
import { Notification, BrowserWindow } from "electron";
import { run, Agent } from "@openai/agents";
import { buildOrchestrator, listAgents, RunSubAgentFn } from "../ai/agents";
import { closeMcpServers } from "../ai/mcp";
import { resolveApprovalsAndRun } from "../ai/runLoop";
import { getDueTasks, recordTaskRun, TaskRow } from "../db/tasksStore";
import { cancelPendingForTrace } from "../db/checklistStore";
import { devLog } from "../devLog";
import { parseStringMap } from "../db/jsonColumn";
import { extractApprovalMeta } from "../ai/runItemMeta";

// A scheduled task runs unattended — there is no user to show an approval dialog to. A
// specialist called as a tool during a headless run (e.g. Chrono's Explorer call) gets the
// same auto-reject the top-level run has always applied to its own approval-gated tools
// (see the KI-5 comment in runPromptTask below), then resumes so the specialist can report
// back that it was blocked, rather than leaving buildOrchestrator with no runSubAgent to
// give its wrapped specialist tools at all.
const runSubAgentHeadless: RunSubAgentFn = async (agent: Agent, input: string, displayName: string) => {
  const runOnce = (segmentInput: unknown) => run(agent, segmentInput as Parameters<typeof run>[1]);
  devLog(`[taskScheduler] running specialist=${displayName} headlessly`);
  const result = await resolveApprovalsAndRun(runOnce, input, async () => false);
  return result?.finalOutput ?? "";
};

const POLL_INTERVAL_MS = 30_000;
// Truncated in the OS notification body so a long agent reply doesn't overflow the
// notification UI — the full text is still readable via last_result in the Tasks widget.
const NOTIFICATION_BODY_MAX_LENGTH = 200;
// task.title is user- or agent-authored with no length cap of its own (it becomes
// `${task.title} — failed` on a failure notification below), so it needs the same
// treatment as the body — otherwise it overflows or gets truncated unpredictably by the
// OS notification layer, differently per platform.
const NOTIFICATION_TITLE_MAX_LENGTH = 100;

let timer: NodeJS.Timeout | null = null;

/** Substitutes `{{key}}` placeholders in a task's prompt with its recurrence_params plus
 * auto-injected run context. Auto-injected keys always win over a same-named user param —
 * same precedence rule as ai/agents.ts's renderPrompt reserving {{agentName}}/{{userName}}/
 * {{currentDateTime}} for its own substitution. Unknown placeholders are left as-is rather
 * than blanked, so a typo'd param name is visible/debuggable instead of silently vanishing. */
export function renderTaskPrompt(
  template: string,
  params: Record<string, string>,
  auto: Record<string, string>
): string {
  const values = { ...params, ...auto };
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
  );
}

/** Next run time for a recurring task, counted from when it actually ran (not from the
 * previously scheduled time) — avoids a catch-up storm of back-to-back runs if the app
 * was closed past several intervals, at the cost of some drift versus wall-clock cadence.
 * Acceptable for a simple-interval scheduler (not a cron-exact one). */
export function computeNextRunAt(nowIso: string, intervalMs: number): string {
  return new Date(new Date(nowIso).getTime() + intervalMs).toISOString();
}

// Mirrors ipc/agent.ts's broadcastTasksUpdate — the scheduler runs independently of any
// renderer-initiated IPC call, so useTasks.ts's cached state would otherwise never learn a
// reminder fired or a recurring task rescheduled until the user happened to trigger some
// other refresh.
function broadcastTasksUpdate(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("tasks:update");
  }
}

/** Exported for testing the title/body truncation (KI-22) — otherwise only reachable via
 * processDueTask, which needs the full poll-loop scaffolding to exercise. */
export function notify(title: string, body: string): void {
  if (!Notification.isSupported()) {
    devLog(`[taskScheduler] Notification not supported on this platform — title="${title}"`);
    return;
  }
  new Notification({
    title: title.slice(0, NOTIFICATION_TITLE_MAX_LENGTH),
    body: body.slice(0, NOTIFICATION_BODY_MAX_LENGTH),
  }).show();
}

/** Exported for testing — the interruption/auto-reject handling below is the KI-5 fix and is
 * otherwise only reachable through the poll loop's setInterval callback. */
export async function runPromptTask(task: TaskRow): Promise<string> {
  // Scopes this task run's checklist_items rows (see ai/tools/checklistTools.ts) the same
  // way ipc/agent.ts's interactive traceId does — scheduled runs had no equivalent id
  // before the checklist feature needed one; nested specialist calls automatically share
  // this same value since buildOrchestrator bakes it into every agent's write_checklist
  // tool at construction time, not per call.
  const traceId = randomUUID();
  const { agent: orchestrator, mcpServers, allAgents } = await buildOrchestrator(runSubAgentHeadless, traceId);
  try {
    let runTarget = orchestrator;
    if (task.prompt_target_agent_id) {
      // Falls back to the orchestrator if the target agent's name can't be resolved (e.g.
      // renamed since the task was created) — same "never surface a routing error, fall
      // back" precedent as agent:runStream's targetAgentName lookup in ipc/agent.ts.
      const targetRow = listAgents().find((a) => a.id === task.prompt_target_agent_id);
      const match = targetRow && allAgents.find((a) => a.name.toLowerCase() === targetRow.name.toLowerCase());
      if (match) runTarget = match;
    }
    const now = new Date();
    const prompt = renderTaskPrompt(task.prompt!, parseStringMap(`tasks ${task.id}/recurrence_params`, task.recurrence_params), {
      lastResult: task.last_result ?? "",
      currentDateTime: now.toLocaleString(),
    });
    devLog(`[taskScheduler] running task id=${task.id} target=${runTarget.name}`);
    const result = await run(runTarget, prompt);

    // A headless run has no renderer to show the approval UI ipc/agent.ts's interactive path
    // uses — result.interruptions was previously never inspected here, so a call to an
    // approval-gated tool (an HTTP write, update_agent's prompt field, create_task) stopped
    // the run and left finalOutput undefined, which this returned as "" — recorded as a
    // completed run with no signal the work never happened. There is no user to ask, so this
    // declines the call(s) rather than leaving the run stuck, and says so explicitly instead
    // of reading as a model that had nothing to say.
    if (result.interruptions.length > 0) {
      const toolNames = result.interruptions.map((i) => extractApprovalMeta(i).toolName ?? "(unknown)");
      for (const interruption of result.interruptions) {
        result.state.reject(interruption, {
          message: "Scheduled tasks run unattended and cannot ask for approval — this call was declined automatically.",
        });
      }
      devLog(`[taskScheduler] task id=${task.id} blocked on approval-gated tool(s): ${toolNames.join(", ")}`);
      // The run stops here, unattended and unresolved — any checklist item still pending
      // for this trace never will resolve, same reasoning as ipc/agent.ts's abandon path.
      cancelPendingForTrace(traceId);
      return `Blocked — needs your approval for: ${toolNames.join(", ")}. Run this task interactively in chat instead.`;
    }

    return result.finalOutput ?? "";
  } catch (e) {
    cancelPendingForTrace(traceId);
    throw e;
  } finally {
    await closeMcpServers(mcpServers);
  }
}

async function processDueTask(task: TaskRow): Promise<void> {
  const nextRunAt = task.recurrence_interval_ms
    ? computeNextRunAt(new Date().toISOString(), task.recurrence_interval_ms)
    : null;

  if (!task.prompt) {
    notify(task.title, task.notes || "Reminder due.");
    recordTaskRun(task.id, null, nextRunAt);
    return;
  }

  try {
    const output = await runPromptTask(task);
    notify(task.title, output || "(no response)");
    recordTaskRun(task.id, output, nextRunAt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    devLog(`[taskScheduler] task id=${task.id} failed: ${message}`);
    notify(`${task.title} — failed`, message);
    recordTaskRun(task.id, `Error: ${message}`, nextRunAt);
  }
}

let pollInFlight = false;
// Tracked separately from the boolean above so app quit can await the actual in-flight
// run rather than just checking whether one exists — see waitForInFlightPoll below.
let inFlightPoll: Promise<void> | null = null;

async function pollOnce(): Promise<void> {
  // A prompt task can take longer than POLL_INTERVAL_MS to run (an LLM call, especially
  // one that uses tools like Gmail send), and a task stays 'pending' until recordTaskRun
  // runs after it completes — without this guard, the next tick's setInterval callback
  // would re-fetch the same still-pending due task and run it again concurrently
  // (duplicate notifications, duplicate side effects like a duplicate email send).
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const due = getDueTasks(new Date().toISOString());
    for (const task of due) {
      await processDueTask(task);
    }
    if (due.length > 0) broadcastTasksUpdate();
  } finally {
    pollInFlight = false;
  }
}

/** Starts the poll loop. Safe to call once at app startup — a second call is a no-op
 * while already running, same guard style as startExplorerDaemon. */
export function startTaskScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    inFlightPoll = pollOnce().finally(() => {
      inFlightPoll = null;
    });
  }, POLL_INTERVAL_MS);
}

/** Stops the poll loop. Called on app quit. */
export function stopTaskScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Resolves once any poll in flight at the moment of the call finishes, or immediately if
 * none is running. stopTaskScheduler only clears the interval — a task already mid-run
 * (an LLM call, possibly using MCP tools) was previously abandoned when the process exited,
 * so runPromptTask's `finally { await closeMcpServers(mcpServers) }` might never complete
 * and MCP subprocesses were orphaned rather than closed. Exported so main/index.ts's
 * before-quit handler can await it (with its own timeout) before actually quitting. */
export function waitForInFlightPoll(): Promise<void> {
  return inFlightPoll ?? Promise.resolve();
}
