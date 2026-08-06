/**
 * Tools for the Task Manager system agent (taskAgent / "Chrono") — CRUD over the `tasks`
 * table (db/tasksStore.ts). Reminders and prompt tasks (one-shot or recurring) are the
 * same underlying row; `prompt` absent means a plain reminder.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { createTask, deleteTask, listTasks, updateTask } from "../../db/tasksStore";

/** Shared by create_task and update_task: a prompt task — one-shot or recurring — runs
 * unattended through a full orchestrator (MCP servers, connectors, HTTP tools all attached,
 * see tasks/scheduler.ts) at a time the conversation that created it may no longer be open.
 * A plain reminder just fires a notification, so it carries none of that risk. Exported so
 * the invariant is unit-testable without invoking the SDK's tool-calling machinery. */
export function promptTaskNeedsApproval(prompt: string | null): boolean {
  return prompt !== null;
}

/** Finds an already-pending task with the same title as one being created.
 *
 * The orchestrator passes a specialist only the `input` string for the current turn, so
 * "call Amar at 10am instead" arrives at Chrono looking exactly like a new reminder — and a
 * second row is created while the 9am one stays live. Reported rather than blocked: two
 * same-named tasks at different times are sometimes genuinely wanted, and silently refusing
 * a create the user did ask for is the worse failure. Exported for direct unit testing. */
export function findDuplicatePendingTask(
  title: string,
  tasks: { id: string; title: string; status: string; next_run_at: string | null }[]
): { id: string; nextRunAt: string | null } | null {
  const normalized = title.trim().toLowerCase();
  const match = tasks.find((t) => t.status === "pending" && t.title.trim().toLowerCase() === normalized);
  return match ? { id: match.id, nextRunAt: match.next_run_at } : null;
}

export const createTaskTool = tool({
  name: "create_task",
  description:
    "Create a reminder or prompt task. Omit prompt for a plain reminder (fires a notification when due). " +
    "Set prompt for a task that runs through an agent when due — set recurrenceIntervalMs to make it repeat " +
    "every that many milliseconds after each run, or omit it for a one-shot run. recurrenceParams are dynamic " +
    "values substituted into {{key}} placeholders in the prompt at run time. Creating a prompt task pauses for " +
    "the user's approval; a plain reminder (no prompt) does not. If the request could be changing something that " +
    "already exists (a new time, a new title for the same thing), call list_tasks first and use update_task on " +
    "that row instead — this tool always adds a new task, it never replaces one.",
  parameters: z.object({
    title: z.string().min(1),
    notes: z.string().nullable(),
    dueAt: z.string().nullable().describe("Absolute ISO datetime — convert any relative phrase yourself first."),
    prompt: z.string().nullable(),
    promptTargetAgentId: z
      .string()
      .nullable()
      .describe("Agent id (from list_agents) to run the prompt against. Null runs it against the orchestrator."),
    recurrenceIntervalMs: z.number().nullable().describe("Repeat interval in milliseconds. Null = one-shot."),
    recurrenceParams: z.record(z.string(), z.string()).nullable(),
  }),
  needsApproval: async (_ctx, { prompt }) => promptTaskNeedsApproval(prompt),
  execute: async ({ title, notes, dueAt, prompt, promptTargetAgentId, recurrenceIntervalMs, recurrenceParams }) => {
    const duplicate = findDuplicatePendingTask(title, listTasks());
    const created = createTask({
      title,
      notes: notes ?? undefined,
      dueAt: dueAt ?? undefined,
      prompt: prompt ?? undefined,
      promptTargetAgentId: promptTargetAgentId ?? undefined,
      recurrenceIntervalMs: recurrenceIntervalMs ?? undefined,
      recurrenceParams: recurrenceParams ?? undefined,
    });
    return {
      id: created.id,
      title: created.title,
      nextRunAt: created.next_run_at,
      ...(duplicate && {
        duplicateWarning:
          `A pending task titled "${created.title}" already existed (id ${duplicate.id}` +
          `${duplicate.nextRunAt ? `, due ${duplicate.nextRunAt}` : ""}) and both now exist. ` +
          "If this was meant to change that one rather than add another, tell the user both exist and ask which they want.",
      }),
    };
  },
});

export const listTasksTool = tool({
  name: "list_tasks",
  description:
    "List every task (reminders and prompt tasks) with id, title, status, due/next-run time, and whether it's recurring. " +
    "Use this to find a task's id before update_task/complete_task/cancel_task/delete_task.",
  parameters: z.object({}),
  execute: async () =>
    listTasks().map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.due_at,
      nextRunAt: t.next_run_at,
      isPromptTask: t.prompt !== null,
      isRecurring: t.recurrence_interval_ms !== null,
      lastResult: t.last_result,
    })),
});

export const updateTaskTool = tool({
  name: "update_task",
  description:
    "Update an existing task's fields. Use list_tasks first to get its id. Only supplied fields change. " +
    "Setting prompt pauses for the user's approval, same as create_task — otherwise a plain reminder could be " +
    "turned into a prompt task without ever going through that gate.",
  parameters: z.object({
    id: z.string(),
    title: z.string().nullable(),
    notes: z.string().nullable(),
    dueAt: z.string().nullable(),
    prompt: z.string().nullable(),
    promptTargetAgentId: z.string().nullable(),
    recurrenceIntervalMs: z.number().nullable(),
    recurrenceParams: z.record(z.string(), z.string()).nullable(),
  }),
  // Mirrors create_task's gate: without this, a plain reminder created unattended could be
  // turned into a prompt task by a second, equally-unattended update_task call — the same
  // outcome as create_task's needsApproval, reached one step later.
  needsApproval: async (_ctx, { prompt }) => promptTaskNeedsApproval(prompt),
  execute: async ({ id, ...rest }) => {
    const patch: Parameters<typeof updateTask>[1] = {};
    if (rest.title !== null) patch.title = rest.title;
    if (rest.notes !== null) patch.notes = rest.notes;
    if (rest.dueAt !== null) patch.dueAt = rest.dueAt;
    if (rest.prompt !== null) patch.prompt = rest.prompt;
    if (rest.promptTargetAgentId !== null) patch.promptTargetAgentId = rest.promptTargetAgentId;
    if (rest.recurrenceIntervalMs !== null) patch.recurrenceIntervalMs = rest.recurrenceIntervalMs;
    if (rest.recurrenceParams !== null) patch.recurrenceParams = rest.recurrenceParams;
    const updated = updateTask(id, patch);
    return { id: updated.id, title: updated.title, nextRunAt: updated.next_run_at };
  },
});

export const completeTaskTool = tool({
  name: "complete_task",
  description: "Mark a task done without deleting it. Use list_tasks first to get its id.",
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const updated = updateTask(id, { status: "done" });
    return { id: updated.id, title: updated.title };
  },
});

export const cancelTaskTool = tool({
  name: "cancel_task",
  description: "Mark a task cancelled without deleting it. Use list_tasks first to get its id.",
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    const updated = updateTask(id, { status: "cancelled" });
    return { id: updated.id, title: updated.title };
  },
});

export const deleteTaskTool = tool({
  name: "delete_task",
  description: "Permanently delete a task. Use list_tasks first to get its id.",
  parameters: z.object({ id: z.string() }),
  execute: async ({ id }) => {
    deleteTask(id);
    return `Deleted.`;
  },
});
