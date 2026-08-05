import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations";

let db: Database.Database;

vi.mock("../../db/index", () => ({
  getDb: () => db,
}));

import { writeChecklist, writeChecklistParams } from "./checklistTools";
import { getChecklistForTrace } from "../../db/checklistStore";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("writeChecklist (backs the write_checklist tool)", () => {
  it("stores items scoped to the calling agent and trace", async () => {
    const rows = writeChecklist(
      { items: [{ text: "Understand intent", status: "completed" }] },
      "Orbit",
      "trace-1"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].agent_name).toBe("Orbit");
    expect(rows[0].trace_id).toBe("trace-1");
  });

  it("scopes two agents in the same turn to their own separate checklists", () => {
    writeChecklist({ items: [{ text: "Orbit's step", status: "pending" }] }, "Orbit", "trace-1");
    writeChecklist({ items: [{ text: "Cipher's step", status: "pending" }] }, "Cipher", "trace-1");

    const all = getChecklistForTrace("trace-1");
    expect(all.map((r) => `${r.agent_name}: ${r.text}`).sort()).toEqual(["Cipher: Cipher's step", "Orbit: Orbit's step"]);
  });

  it("replaces rather than appends on a second call from the same agent", () => {
    writeChecklist({ items: [{ text: "First plan", status: "pending" }] }, "Orbit", "trace-1");
    writeChecklist({ items: [{ text: "Revised plan", status: "in_progress" }] }, "Orbit", "trace-1");

    const rows = getChecklistForTrace("trace-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Revised plan");
    expect(rows[0].status).toBe("in_progress");
  });
});

describe("writeChecklistParams schema", () => {
  it("accepts a well-formed checklist", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "Do the thing", status: "pending" }],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty checklist (clearing it)", () => {
    expect(writeChecklistParams.safeParse({ items: [] }).success).toBe(true);
  });

  it("rejects an unknown status value", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "Do the thing", status: "done" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an item with empty text", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "", status: "pending" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects text over the length cap", () => {
    const result = writeChecklistParams.safeParse({
      items: [{ text: "x".repeat(201), status: "pending" }],
    });
    expect(result.success).toBe(false);
  });
});
