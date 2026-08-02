import { randomUUID } from "node:crypto";
import { getDb } from "./index";

/** See migrations.ts v28 (tasks table). `prompt === null` is a plain reminder; otherwise
 * the scheduler runs `prompt` through an agent when due. */
export interface TaskRow {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  status: "pending" | "done" | "cancelled";
  prompt: string | null;
  prompt_target_agent_id: string | null;
  recurrence_interval_ms: number | null;
  recurrence_params: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskCreateInput {
  title: string;
  notes?: string;
  dueAt?: string;
  prompt?: string;
  promptTargetAgentId?: string;
  recurrenceIntervalMs?: number;
  recurrenceParams?: Record<string, string>;
}

export interface TaskUpdatePatch {
  title?: string;
  notes?: string;
  dueAt?: string;
  status?: "pending" | "done" | "cancelled";
  prompt?: string;
  promptTargetAgentId?: string;
  recurrenceIntervalMs?: number;
  recurrenceParams?: Record<string, string>;
}

// A task's initial next_run_at is due_at itself — the scheduler doesn't distinguish
// "reminder due" from "prompt run due", it just fires whatever the row says to do once
// next_run_at passes. Without an explicit due_at, a prompt task has no next_run_at and
// the scheduler never picks it up (a task manager, not a "run this now" tool).
export function createTask(input: TaskCreateInput): TaskRow {
  const title = input.title.trim();
  if (!title) {
    throw new Error("Task title is required.");
  }
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO tasks (
       id, title, notes, due_at, prompt, prompt_target_agent_id,
       recurrence_interval_ms, recurrence_params, next_run_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    title,
    input.notes?.trim() || null,
    input.dueAt ?? null,
    input.prompt?.trim() || null,
    input.promptTargetAgentId ?? null,
    input.recurrenceIntervalMs ?? null,
    JSON.stringify(input.recurrenceParams ?? {}),
    input.dueAt ?? null
  );
  return getTask(id)!;
}

export function getTask(id: string): TaskRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as TaskRow | undefined;
}

export function listTasks(): TaskRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM tasks ORDER BY (next_run_at IS NULL), next_run_at, created_at").all() as TaskRow[];
}

/** Rows the scheduler should act on right now: pending, with a next_run_at at or before `now`. */
export function getDueTasks(now: string): TaskRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM tasks WHERE status = 'pending' AND next_run_at IS NOT NULL AND next_run_at <= ?")
    .all(now) as TaskRow[];
}

export function updateTask(id: string, patch: TaskUpdatePatch): TaskRow {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) {
    throw new Error(`Unknown task: ${id}`);
  }
  if (patch.title !== undefined && patch.title.trim().length === 0) {
    throw new Error("Task title cannot be blank.");
  }
  const next = {
    title: patch.title === undefined ? existing.title : patch.title.trim(),
    notes: patch.notes === undefined ? existing.notes : patch.notes.trim() || null,
    due_at: patch.dueAt === undefined ? existing.due_at : patch.dueAt,
    status: patch.status === undefined ? existing.status : patch.status,
    prompt: patch.prompt === undefined ? existing.prompt : patch.prompt.trim() || null,
    prompt_target_agent_id:
      patch.promptTargetAgentId === undefined ? existing.prompt_target_agent_id : patch.promptTargetAgentId,
    recurrence_interval_ms:
      patch.recurrenceIntervalMs === undefined ? existing.recurrence_interval_ms : patch.recurrenceIntervalMs,
    recurrence_params:
      patch.recurrenceParams === undefined ? existing.recurrence_params : JSON.stringify(patch.recurrenceParams),
    // Changing due_at re-arms next_run_at for a still-pending task, mirroring createTask's
    // initial next_run_at = due_at — otherwise editing a reminder's due time would silently
    // leave the scheduler watching the old time.
    next_run_at: patch.dueAt === undefined ? existing.next_run_at : patch.dueAt,
  };
  db.prepare(
    `UPDATE tasks SET title = ?, notes = ?, due_at = ?, status = ?, prompt = ?, prompt_target_agent_id = ?,
       recurrence_interval_ms = ?, recurrence_params = ?, next_run_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    next.title,
    next.notes,
    next.due_at,
    next.status,
    next.prompt,
    next.prompt_target_agent_id,
    next.recurrence_interval_ms,
    next.recurrence_params,
    next.next_run_at,
    id
  );
  return getTask(id)!;
}

export function deleteTask(id: string): void {
  const db = getDb();
  const existing = getTask(id);
  if (!existing) {
    throw new Error(`Unknown task: ${id}`);
  }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/** Called by the scheduler after acting on a due task. Recurring tasks get rescheduled to
 * `nextRunAt` and stay 'pending'; one-shot tasks (no recurrence) are marked 'done'. */
export function recordTaskRun(id: string, result: string | null, nextRunAt: string | null): void {
  const db = getDb();
  db.prepare(
    `UPDATE tasks SET last_run_at = datetime('now'), last_result = ?, next_run_at = ?,
       status = CASE WHEN ? IS NULL THEN 'done' ELSE 'pending' END, updated_at = datetime('now')
     WHERE id = ?`
  ).run(result, nextRunAt, nextRunAt, id);
}
