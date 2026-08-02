import { ipcMain } from "electron";
import { createTask, deleteTask, listTasks, TaskCreateInput, TaskRow, TaskUpdatePatch, updateTask } from "../db/tasksStore";

export type { TaskRow, TaskCreateInput, TaskUpdatePatch } from "../db/tasksStore";

/**
 * These handlers used to pass their arguments straight to the store, with the parameter types
 * standing in for a check they never performed. Every other write surface in ipc/ asserts its
 * input — mcp, httpTools, connectors, knowledgeBase, filesystem and agentData all do — and tasks
 * was the last one that didn't. Tasks aren't inert either: tasks/scheduler.ts reads them back and
 * runs their prompts.
 *
 * Same shape as the assertions in ipc/httpTools.ts, deliberately, so there is one idiom here.
 */
function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}

function assertPlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
}

const STRING_FIELDS = ["title", "notes", "dueAt", "prompt", "promptTargetAgentId"] as const;
const TASK_STATUSES = ["pending", "done", "cancelled"];

/** Checks the fields create and update share. Absent is always fine — a patch names only what it
 * changes, and create's other fields are genuinely optional. */
function assertTaskFields(input: Record<string, unknown>, prefix: string): void {
  for (const field of STRING_FIELDS) {
    const value = input[field];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`${prefix}: ${field} must be a string`);
    }
  }

  if (input.status !== undefined && (typeof input.status !== "string" || !TASK_STATUSES.includes(input.status))) {
    throw new Error(`${prefix}: status must be one of ${TASK_STATUSES.join(", ")}`);
  }

  const interval = input.recurrenceIntervalMs;
  if (interval !== undefined) {
    // A recurring task's interval becomes a scheduler delay. Zero, negative or NaN would either
    // never fire or fire continuously, and neither failure says why.
    if (typeof interval !== "number" || !Number.isFinite(interval) || interval <= 0) {
      throw new Error(`${prefix}: recurrenceIntervalMs must be a positive number`);
    }
  }

  const params = input.recurrenceParams;
  if (params !== undefined) {
    assertPlainObject(params, `${prefix}: recurrenceParams must be a plain object`);
    for (const value of Object.values(params)) {
      // Stored as JSON and rendered into the task's prompt by scheduler.ts, so a non-string
      // would reach the model as "[object Object]".
      if (typeof value !== "string") throw new Error(`${prefix}: recurrenceParams values must be strings`);
    }
  }
}

export function registerTaskHandlers() {
  ipcMain.handle("tasks:list", (): TaskRow[] => listTasks());

  ipcMain.handle("tasks:create", (_event, input: unknown): TaskRow => {
    assertPlainObject(input, "tasks:create requires a plain object input");
    assertNonEmptyString(input.title, "tasks:create requires a non-empty title");
    assertTaskFields(input, "tasks:create");
    return createTask(input as unknown as TaskCreateInput);
  });

  ipcMain.handle("tasks:update", (_event, id: unknown, patch: unknown): TaskRow => {
    assertNonEmptyString(id, "tasks:update requires a non-empty task id");
    assertPlainObject(patch, "tasks:update requires a plain object patch");
    // Title is optional in a patch, but an explicitly blank one would leave the task unnamed in
    // every list that shows it.
    if (patch.title !== undefined) assertNonEmptyString(patch.title, "tasks:update title cannot be empty");
    assertTaskFields(patch, "tasks:update");
    return updateTask(id, patch as unknown as TaskUpdatePatch);
  });

  ipcMain.handle("tasks:complete", (_event, id: unknown): TaskRow => {
    assertNonEmptyString(id, "tasks:complete requires a non-empty task id");
    return updateTask(id, { status: "done" });
  });

  ipcMain.handle("tasks:delete", (_event, id: unknown): void => {
    assertNonEmptyString(id, "tasks:delete requires a non-empty task id");
    deleteTask(id);
  });
}
