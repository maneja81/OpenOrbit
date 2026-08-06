import { getDb } from "./index";

/** See migrations.ts's checklist_items table (v "20260805120000"). */
export type ChecklistItemStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface ChecklistItemRow {
  id: number;
  trace_id: string;
  agent_name: string;
  position: number;
  text: string;
  status: ChecklistItemStatus;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItemInput {
  text: string;
  status: ChecklistItemStatus;
}

/**
 * Full-replace scoped to `(traceId, agentName)` — the write_checklist tool's whole
 * contract (see ai/tools/checklistTools.ts). Deletes every existing row for this agent's
 * slice of the trace, then reinserts in the order given, so `position` always matches the
 * array index without a separate reorder step. One transaction so a partial write (crash
 * mid-replace) can never leave the agent's checklist half-old-half-new.
 *
 * Deliberately scoped by `agentName` in the same call rather than a shared "replace the
 * whole trace" operation — a specialist writing its own checklist must never be able to
 * touch the orchestrator's rows for the same turn, or vice versa.
 */
export function replaceChecklistForAgent(
  traceId: string,
  agentName: string,
  items: ChecklistItemInput[]
): ChecklistItemRow[] {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare("DELETE FROM checklist_items WHERE trace_id = ? AND agent_name = ?").run(traceId, agentName);
    const insert = db.prepare(
      "INSERT INTO checklist_items (trace_id, agent_name, position, text, status) VALUES (?, ?, ?, ?, ?)"
    );
    items.forEach((item, index) => {
      insert.run(traceId, agentName, index, item.text, item.status);
    });
  });
  run();
  return db
    .prepare("SELECT * FROM checklist_items WHERE trace_id = ? AND agent_name = ? ORDER BY position")
    .all(traceId, agentName) as ChecklistItemRow[];
}

/** Every item across every agent for one turn — ordered by agent name, then each agent's
 * own position, rather than by row id: a full-replace deletes and reinserts on every write,
 * so id order would reshuffle unpredictably as different agents rewrite their own slice at
 * different times. Grouping by agent_name keeps display order stable regardless of who
 * wrote most recently. */
export function getChecklistForTrace(traceId: string): ChecklistItemRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM checklist_items WHERE trace_id = ? ORDER BY agent_name, position")
    .all(traceId) as ChecklistItemRow[];
}

/** Marks every not-yet-finished item for a trace as cancelled — called when a run ends
 * abnormally (error, timeout), mirroring ipc/agent.ts's existing abandonApprovalsFor
 * pattern, so a broken run doesn't leave the checklist widget showing a permanently
 * "in progress" item that will never actually resolve. */
export function cancelPendingForTrace(traceId: string): void {
  const db = getDb();
  db.prepare(
    `UPDATE checklist_items SET status = 'cancelled', updated_at = datetime('now')
     WHERE trace_id = ? AND status IN ('pending', 'in_progress')`
  ).run(traceId);
}
