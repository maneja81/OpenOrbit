/**
 * Tools for the Task Manager system agent (taskAgent / "Chrono") — CRUD over the `tasks`
 * table (db/tasksStore.ts). Reminders and prompt tasks (one-shot or recurring) are the
 * same underlying row; `prompt` absent means a plain reminder.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { createTask, deleteTask, listTasks, updateTask } from "../../db/tasksStore";

export const createTaskTool = tool({
  name: "create_task",
  description:
    "Create a reminder or prompt task. Omit prompt for a plain reminder (fires a notification when due). " +
    "Set prompt for a task that runs through an agent when due — set recurrenceIntervalMs to make it repeat " +
    "every that many milliseconds after each run, or omit it for a one-shot run. recurrenceParams are dynamic " +
    "values substituted into {{key}} placeholders in the prompt at run time.",
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
  execute: async ({ title, notes, dueAt, prompt, promptTargetAgentId, recurrenceIntervalMs, recurrenceParams }) => {
    const created = createTask({
      title,
      notes: notes ?? undefined,
      dueAt: dueAt ?? undefined,
      prompt: prompt ?? undefined,
      promptTargetAgentId: promptTargetAgentId ?? undefined,
      recurrenceIntervalMs: recurrenceIntervalMs ?? undefined,
      recurrenceParams: recurrenceParams ?? undefined,
    });
    return { id: created.id, title: created.title, nextRunAt: created.next_run_at };
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
  description: "Update an existing task's fields. Use list_tasks first to get its id. Only supplied fields change.",
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
