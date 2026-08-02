/**
 * Task Manager scheduler: polls the `tasks` table (see db/tasksStore.ts) for due rows and
 * acts on them — firing an OS notification for a plain reminder, or running `prompt`
 * headlessly through an agent and notifying with the result. Only runs while the app
 * process is alive (same limitation as ai/webSearchDaemon.ts's child process — no
 * OS-level launchd/Task Scheduler integration), started/stopped from main/index.ts
 * alongside the explorer daemon.
 */

import { Notification, BrowserWindow } from "electron";
import { run } from "@openai/agents";
import { buildOrchestrator, listAgents } from "../ai/agents";
import { closeMcpServers } from "../ai/mcp";
import { getDueTasks, recordTaskRun, TaskRow } from "../db/tasksStore";
import { devLog } from "../devLog";
import { parseStringMap } from "../db/jsonColumn";

const POLL_INTERVAL_MS = 30_000;
// Truncated in the OS notification body so a long agent reply doesn't overflow the
// notification UI — the full text is still readable via last_result in the Tasks widget.
const NOTIFICATION_BODY_MAX_LENGTH = 200;

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

function notify(title: string, body: string): void {
  if (!Notification.isSupported()) {
    devLog(`[taskScheduler] Notification not supported on this platform — title="${title}"`);
    return;
  }
  new Notification({ title, body: body.slice(0, NOTIFICATION_BODY_MAX_LENGTH) }).show();
}

async function runPromptTask(task: TaskRow): Promise<string> {
  const { agent: orchestrator, mcpServers, allAgents } = await buildOrchestrator();
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
    return result.finalOutput ?? "";
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
    void pollOnce();
  }, POLL_INTERVAL_MS);
}

/** Stops the poll loop. Called on app quit. */
export function stopTaskScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
