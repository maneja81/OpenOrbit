import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));

import { createTask, deleteTask, getDueTasks, getTask, listTasks, recordTaskRun, updateTask } from "./tasksStore";

function seedAgent(id: string) {
  db.prepare(
    `INSERT INTO agents (id, name, prompt, model) VALUES (?, ?, 'You are a test agent.', 'gpt-4.1-mini')`
  ).run(id, id);
}

describe("tasksStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    seedAgent("budget-agent");
  });

  it("creates a plain reminder with next_run_at seeded from dueAt", () => {
    const task = createTask({ title: "Pay rent", dueAt: "2026-08-01T09:00:00.000Z" });
    expect(task.title).toBe("Pay rent");
    expect(task.status).toBe("pending");
    expect(task.prompt).toBeNull();
    expect(task.next_run_at).toBe("2026-08-01T09:00:00.000Z");
  });

  it("rejects a blank title", () => {
    expect(() => createTask({ title: "   " })).toThrow(/title is required/i);
  });

  it("creates a prompt task targeting a specific agent with recurrence params", () => {
    const task = createTask({
      title: "Daily standup summary",
      prompt: "Summarize {{project}} progress since {{lastResult}}",
      promptTargetAgentId: "budget-agent",
      recurrenceIntervalMs: 86_400_000,
      recurrenceParams: { project: "Alex" },
      dueAt: "2026-08-01T09:00:00.000Z",
    });
    expect(task.prompt_target_agent_id).toBe("budget-agent");
    expect(task.recurrence_interval_ms).toBe(86_400_000);
    expect(JSON.parse(task.recurrence_params)).toEqual({ project: "Alex" });
  });

  it("lists tasks ordered by next_run_at, nulls last", () => {
    createTask({ title: "No due date" });
    createTask({ title: "Later", dueAt: "2026-08-02T00:00:00.000Z" });
    createTask({ title: "Sooner", dueAt: "2026-08-01T00:00:00.000Z" });
    const titles = listTasks().map((t) => t.title);
    expect(titles).toEqual(["Sooner", "Later", "No due date"]);
  });

  it("getDueTasks returns only pending tasks at or before now", () => {
    createTask({ title: "Past due", dueAt: "2020-01-01T00:00:00.000Z" });
    createTask({ title: "Future", dueAt: "2099-01-01T00:00:00.000Z" });
    createTask({ title: "No due date" });
    const due = getDueTasks(new Date().toISOString());
    expect(due.map((t) => t.title)).toEqual(["Past due"]);
  });

  it("excludes non-pending tasks from getDueTasks even if next_run_at has passed", () => {
    const task = createTask({ title: "Past due", dueAt: "2020-01-01T00:00:00.000Z" });
    updateTask(task.id, { status: "cancelled" });
    expect(getDueTasks(new Date().toISOString())).toEqual([]);
  });

  it("updateTask re-arms next_run_at when dueAt changes", () => {
    const task = createTask({ title: "Reminder", dueAt: "2026-08-01T00:00:00.000Z" });
    const updated = updateTask(task.id, { dueAt: "2026-09-01T00:00:00.000Z" });
    expect(updated.due_at).toBe("2026-09-01T00:00:00.000Z");
    expect(updated.next_run_at).toBe("2026-09-01T00:00:00.000Z");
  });

  it("updateTask rejects a blank title", () => {
    const task = createTask({ title: "Reminder" });
    expect(() => updateTask(task.id, { title: "  " })).toThrow(/cannot be blank/i);
  });

  it("updateTask throws for an unknown id", () => {
    expect(() => updateTask("does-not-exist", { title: "x" })).toThrow(/unknown task/i);
  });

  it("deleteTask removes the row", () => {
    const task = createTask({ title: "Reminder" });
    deleteTask(task.id);
    expect(getTask(task.id)).toBeUndefined();
  });

  it("deleteTask throws for an unknown id", () => {
    expect(() => deleteTask("does-not-exist")).toThrow(/unknown task/i);
  });

  it("recordTaskRun marks a one-shot task done when nextRunAt is null", () => {
    const task = createTask({ title: "One-shot", dueAt: "2020-01-01T00:00:00.000Z" });
    recordTaskRun(task.id, "Result text", null);
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("done");
    expect(updated.last_result).toBe("Result text");
    expect(updated.next_run_at).toBeNull();
  });

  it("recordTaskRun keeps a recurring task pending and reschedules it", () => {
    const task = createTask({
      title: "Recurring",
      prompt: "Check in",
      recurrenceIntervalMs: 60_000,
      dueAt: "2020-01-01T00:00:00.000Z",
    });
    recordTaskRun(task.id, "ok", "2020-01-01T00:01:00.000Z");
    const updated = getTask(task.id)!;
    expect(updated.status).toBe("pending");
    expect(updated.next_run_at).toBe("2020-01-01T00:01:00.000Z");
  });

  it("clears prompt_target_agent_id when the target agent is deleted (ON DELETE SET NULL)", () => {
    const task = createTask({ title: "Prompt task", prompt: "Do it", promptTargetAgentId: "budget-agent" });
    db.prepare("DELETE FROM agents WHERE id = ?").run("budget-agent");
    expect(getTask(task.id)!.prompt_target_agent_id).toBeNull();
  });
});
