import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));

import { replaceChecklistForAgent, getChecklistForTrace, cancelPendingForTrace } from "./checklistStore";

beforeEach(() => {
  db = new Database(":memory:");
  runMigrations(db);
});

describe("replaceChecklistForAgent", () => {
  it("inserts items in order, with position matching array index", () => {
    const rows = replaceChecklistForAgent("trace-1", "Orbit", [
      { text: "Understand intent", status: "completed" },
      { text: "Respond to user", status: "in_progress" },
    ]);
    expect(rows.map((r) => [r.position, r.text, r.status])).toEqual([
      [0, "Understand intent", "completed"],
      [1, "Respond to user", "in_progress"],
    ]);
  });

  it("fully replaces a prior write for the same (trace, agent), not appending to it", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "Old plan", status: "pending" }]);
    const rows = replaceChecklistForAgent("trace-1", "Orbit", [{ text: "New plan", status: "pending" }]);
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("New plan");
  });

  it("never touches another agent's rows for the same trace", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "Orbit's plan", status: "pending" }]);
    replaceChecklistForAgent("trace-1", "Cipher", [{ text: "Cipher's plan", status: "pending" }]);

    const orbitRows = replaceChecklistForAgent("trace-1", "Orbit", [{ text: "Orbit's revised plan", status: "pending" }]);
    expect(orbitRows.map((r) => r.text)).toEqual(["Orbit's revised plan"]);

    const all = getChecklistForTrace("trace-1");
    expect(all.map((r) => r.agent_name).sort()).toEqual(["Cipher", "Orbit"]);
    expect(all.find((r) => r.agent_name === "Cipher")?.text).toBe("Cipher's plan");
  });

  it("never touches another trace's rows for the same agent", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "Trace 1 plan", status: "pending" }]);
    replaceChecklistForAgent("trace-2", "Orbit", [{ text: "Trace 2 plan", status: "pending" }]);

    expect(getChecklistForTrace("trace-1").map((r) => r.text)).toEqual(["Trace 1 plan"]);
    expect(getChecklistForTrace("trace-2").map((r) => r.text)).toEqual(["Trace 2 plan"]);
  });

  it("clears a checklist by replacing with an empty array", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "One item", status: "pending" }]);
    const rows = replaceChecklistForAgent("trace-1", "Orbit", []);
    expect(rows).toEqual([]);
  });
});

describe("getChecklistForTrace", () => {
  it("returns an empty array for a trace with no checklist yet", () => {
    expect(getChecklistForTrace("no-such-trace")).toEqual([]);
  });

  it("orders by agent name, then position — not by write recency", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [
      { text: "Orbit item 1", status: "pending" },
      { text: "Orbit item 2", status: "pending" },
    ]);
    replaceChecklistForAgent("trace-1", "Atlas", [{ text: "Atlas item 1", status: "pending" }]);
    // Rewriting Orbit's list after Atlas's write must not reshuffle Atlas ahead of or
    // behind Orbit based on row-id recency.
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "Orbit item 1 (revised)", status: "pending" }]);

    const rows = getChecklistForTrace("trace-1");
    expect(rows.map((r) => r.agent_name)).toEqual(["Atlas", "Orbit"]);
  });
});

describe("cancelPendingForTrace", () => {
  it("cancels pending and in_progress items, leaving completed ones alone", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [
      { text: "Done already", status: "completed" },
      { text: "Still going", status: "in_progress" },
      { text: "Not started", status: "pending" },
    ]);

    cancelPendingForTrace("trace-1");

    const rows = getChecklistForTrace("trace-1");
    expect(rows.map((r) => r.status)).toEqual(["completed", "cancelled", "cancelled"]);
  });

  it("does nothing to a trace with no rows", () => {
    expect(() => cancelPendingForTrace("no-such-trace")).not.toThrow();
  });

  it("leaves other traces untouched", () => {
    replaceChecklistForAgent("trace-1", "Orbit", [{ text: "A", status: "pending" }]);
    replaceChecklistForAgent("trace-2", "Orbit", [{ text: "B", status: "pending" }]);

    cancelPendingForTrace("trace-1");

    expect(getChecklistForTrace("trace-2")[0].status).toBe("pending");
  });
});
