import { describe, expect, it } from "vitest";
import { promptTaskNeedsApproval, findDuplicatePendingTask } from "./taskAgentTools";

describe("promptTaskNeedsApproval (backs create_task/update_task's needsApproval)", () => {
  // KI-4: create_task ran unattended regardless of whether it carried a prompt, and a
  // one-shot or recurring prompt task runs through a full orchestrator (MCP servers,
  // connectors, HTTP tools all attached) at a time the conversation that created it may no
  // longer be open — the same persistence risk update_agent's prompt field carries.
  it("does not require approval for a plain reminder (no prompt)", () => {
    expect(promptTaskNeedsApproval(null)).toBe(false);
  });

  it("requires approval for a prompt task, one-shot or recurring", () => {
    expect(promptTaskNeedsApproval("Summarize my unread email")).toBe(true);
  });
});

describe("findDuplicatePendingTask (backs create_task's duplicateWarning)", () => {
  const task = (over: Partial<{ id: string; title: string; status: string; next_run_at: string | null }> = {}) => ({
    id: "t1",
    title: "Call Amar",
    status: "pending",
    next_run_at: "2026-08-07T09:00:00",
    ...over,
  });

  // The real incident: "no i need t call him at 10 am" reached Chrono as a fresh create,
  // because a specialist sees only the current turn's input — so a second "Call Amar" row
  // was made while the 9am one stayed live, and the user had to catch it.
  it("finds an existing pending task with the same title", () => {
    expect(findDuplicatePendingTask("Call Amar", [task()])).toEqual({
      id: "t1",
      nextRunAt: "2026-08-07T09:00:00",
    });
  });

  it("matches regardless of case and surrounding whitespace", () => {
    expect(findDuplicatePendingTask("  call amar ", [task()])?.id).toBe("t1");
  });

  it("ignores tasks that are no longer pending", () => {
    expect(findDuplicatePendingTask("Call Amar", [task({ status: "completed" }), task({ id: "t2", status: "cancelled" })])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(findDuplicatePendingTask("Call Priya", [task()])).toBeNull();
  });

  it("returns null against an empty task list", () => {
    expect(findDuplicatePendingTask("Call Amar", [])).toBeNull();
  });

  it("carries a null next-run time through rather than dropping the match", () => {
    expect(findDuplicatePendingTask("Call Amar", [task({ next_run_at: null })])).toEqual({ id: "t1", nextRunAt: null });
  });
});
