import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));

import { deleteAgentData, getAgentData, listAgentData, setAgentData } from "./agentDataStore";

function seedAgent(id: string) {
  db.prepare(
    `INSERT INTO agents (id, name, prompt, model) VALUES (?, ?, 'You are a test agent.', 'gpt-4.1-mini')`
  ).run(id, id);
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
});
