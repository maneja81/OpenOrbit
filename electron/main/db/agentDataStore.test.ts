import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));
vi.mock("../devLog", () => ({ devLog: () => {} }));

import { deleteAgentData, getAgentData, listAgentData, setAgentData } from "./agentDataStore";

function seedAgent(id: string) {
  db.prepare(
    `INSERT INTO agents (id, name, prompt, model) VALUES (?, ?, 'You are a test agent.', 'gpt-4.1-mini')`
  ).run(id, id);
}

/** Writes a raw string straight into the value column, bypassing setAgentData's JSON.stringify —
 * the only way to reproduce a row that isn't valid JSON (partial write, hand-edited DB, or a
 * value written by a path that forgot to stringify). */
function writeRawValue(agentId: string, key: string, raw: string): void {
  db.prepare("INSERT INTO agent_data (agent_id, key, value) VALUES (?, ?, ?)").run(agentId, key, raw);
}

describe("agentDataStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    seedAgent("budget-agent");
    seedAgent("other-agent");
  });

  it("returns the default value when no data is stored yet", () => {
    expect(getAgentData("budget-agent", "monthly_budget", null)).toBeNull();
  });

  it("saves and reads back a value, round-trip", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    expect(getAgentData("budget-agent", "monthly_budget", null)).toBe("1200");
  });

  it("overwrites an existing key on a second save", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    setAgentData("budget-agent", "monthly_budget", "1500");
    expect(getAgentData("budget-agent", "monthly_budget", null)).toBe("1500");
  });

  it("lists every key/value pair stored for one agent", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    setAgentData("budget-agent", "currency", "USD");
    expect(listAgentData("budget-agent")).toEqual({ monthly_budget: "1200", currency: "USD" });
  });

  it("deletes a key", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    deleteAgentData("budget-agent", "monthly_budget");
    expect(getAgentData("budget-agent", "monthly_budget", null)).toBeNull();
  });

  it("isolates data between agents", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    setAgentData("other-agent", "monthly_budget", "9999");
    expect(getAgentData("budget-agent", "monthly_budget", null)).toBe("1200");
    expect(listAgentData("other-agent")).toEqual({ monthly_budget: "9999" });
  });

  it("cascades delete when the owning agent is deleted", () => {
    setAgentData("budget-agent", "monthly_budget", "1200");
    db.prepare("DELETE FROM agents WHERE id = ?").run("budget-agent");
    expect(listAgentData("budget-agent")).toEqual({});
  });

  describe("a row that isn't valid JSON", () => {
    it("falls back to the default rather than throwing out of getAgentData", () => {
      writeRawValue("budget-agent", "monthly_budget", "{not json");
      expect(getAgentData("budget-agent", "monthly_budget", "fallback")).toBe("fallback");
    });

    it("is skipped by listAgentData, which still returns the rest", () => {
      // One corrupt row used to throw here and take down every read for that agent.
      setAgentData("budget-agent", "currency", "USD");
      writeRawValue("budget-agent", "monthly_budget", "{not json");
      setAgentData("budget-agent", "timezone", "UTC");

      expect(listAgentData("budget-agent")).toEqual({ currency: "USD", timezone: "UTC" });
    });

    it("is omitted from listAgentData rather than set to undefined", () => {
      writeRawValue("budget-agent", "monthly_budget", "{not json");
      expect("monthly_budget" in listAgentData("budget-agent")).toBe(false);
    });

    it("does not throw when every row for the agent is corrupt", () => {
      writeRawValue("budget-agent", "a", "{");
      writeRawValue("budget-agent", "b", "undefined");
      expect(listAgentData("budget-agent")).toEqual({});
    });

    it("does not affect a different agent's rows", () => {
      writeRawValue("budget-agent", "monthly_budget", "{not json");
      setAgentData("other-agent", "monthly_budget", "9999");
      expect(listAgentData("other-agent")).toEqual({ monthly_budget: "9999" });
    });

    it("can still be cleared with deleteAgentData", () => {
      writeRawValue("budget-agent", "monthly_budget", "{not json");
      deleteAgentData("budget-agent", "monthly_budget");
      expect(listAgentData("budget-agent")).toEqual({});
    });

    it("keeps a stored null distinct from a corrupt row", () => {
      setAgentData("budget-agent", "explicit_null", null);
      expect(getAgentData("budget-agent", "explicit_null", "fallback")).toBeNull();
    });
  });
});
