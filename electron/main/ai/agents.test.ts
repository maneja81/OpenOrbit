import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

let db: Database.Database;

vi.mock("../db", () => ({
  getDb: () => db,
}));

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

import {
  attachConnectorsForIds,
  attachConnectorsForRow,
  buildUpdateAgentPatch,
  createAgent,
  deleteAgent,
  exportAgent,
  exportAllAgents,
  importAgent,
  listAgents,
  updateAgent,
} from "./agents";
import { saveConnectorCredentials } from "../db/connectorsStore";

describe("createAgent (backs Cipher's create_agent tool)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("creates a custom agent with a slugified id, enabled by default", () => {
    const created = createAgent({
      name: "Recipe Helper",
      tagline: "Cooking ideas",
      description: "Suggests recipes from what's in the fridge.",
      prompt: "You are Recipe Helper...",
    });

    expect(created.id).toBe("recipe-helper");
    expect(created.name).toBe("Recipe Helper");
    expect(created.enabled).toBe(1);
    expect(created.system).toBe(0);
    expect(created.model).toBe("gpt-4.1-mini");
  });

  it("dedupes ids for agents with colliding names", () => {
    createAgent({ name: "Helper", prompt: "p1" });
    const second = createAgent({ name: "Helper", prompt: "p2" });
    expect(second.id).toBe("helper-2");
  });

  it("accepts an explicit valid OpenRouter model id", () => {
    const created = createAgent({ name: "Coder", prompt: "p", model: "anthropic/claude-3.5-sonnet" });
    expect(created.model).toBe("anthropic/claude-3.5-sonnet");
  });

  it("accepts a plain native model id (no provider prefix)", () => {
    const created = createAgent({ name: "Coder", prompt: "p", model: "gpt-4.1-mini" });
    expect(created.model).toBe("gpt-4.1-mini");
  });

  it("rejects a malformed model id", () => {
    expect(() => createAgent({ name: "Coder", prompt: "p", model: "not a valid id!" })).toThrow(
      /doesn't look like a valid model ID/
    );
  });

  it("rejects an empty name", () => {
    expect(() => createAgent({ name: "   ", prompt: "p" })).toThrow("Agent name is required.");
  });

  it("shows up in listAgents alongside the seeded defaults", () => {
    createAgent({ name: "Recipe Helper", prompt: "p" });
    const rows = listAgents();
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(["configAgent", "knowledgeAgent", "explorerAgent", "recipe-helper"]));
  });
});

describe("updateAgent (backs Cipher's update_agent tool)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("updates only the fields present in the patch, leaving the rest untouched", () => {
    const created = createAgent({ name: "Recipe Helper", tagline: "Cooking ideas", prompt: "p1" });
    const updated = updateAgent(created.id, { tagline: "New tagline" });

    expect(updated.tagline).toBe("New tagline");
    expect(updated.name).toBe("Recipe Helper");
    expect(updated.prompt).toBe("p1");
  });

  it("updates enabled state and mcpServerIds for a custom agent", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p1" });
    const updated = updateAgent(created.id, { enabled: false, mcpServerIds: ["srv-1"] });

    expect(updated.enabled).toBe(0);
    expect(JSON.parse(updated.mcp_server_ids)).toEqual(["srv-1"]);
  });

  it("throws for an unknown agent id", () => {
    expect(() => updateAgent("does-not-exist", { name: "X" })).toThrow("Unknown agent: does-not-exist");
  });

  it("rejects a malformed model id", () => {
    const created = createAgent({ name: "Coder", prompt: "p" });
    expect(() => updateAgent(created.id, { model: "not a valid id!" })).toThrow(
      /doesn't look like a valid model ID/
    );
  });

  it("blocks disabling a system agent but still allows editing its prompt/name/model", () => {
    expect(() => updateAgent("configAgent", { enabled: false })).toThrow(/system agent and cannot be disabled/);

    const updated = updateAgent("configAgent", { name: "Cipher 2.0", prompt: "new prompt" });
    expect(updated.name).toBe("Cipher 2.0");
    expect(updated.prompt).toBe("new prompt");
  });

  it("rejects an explicitly blank name instead of silently keeping the old one", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p1" });
    expect(() => updateAgent(created.id, { name: "   " })).toThrow("Agent name cannot be blank.");
  });
});

describe("buildUpdateAgentPatch (backs Cipher's update_agent tool)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  const allNull = {
    name: null,
    tagline: null,
    description: null,
    prompt: null,
    model: null,
    enabled: null,
    mcpServerIds: null,
    connectorIds: null,
  };

  it("omits every field when all tool args are null", () => {
    expect(buildUpdateAgentPatch(allNull)).toEqual({});
  });

  it("includes only the non-null fields, preserving their values", () => {
    const patch = buildUpdateAgentPatch({
      ...allNull,
      tagline: "New tagline",
      enabled: false,
      mcpServerIds: ["srv-1", "srv-2"],
    });

    expect(patch).toEqual({ tagline: "New tagline", enabled: false, mcpServerIds: ["srv-1", "srv-2"] });
  });

  it("round-trips a full patch through updateAgent", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p1" });
    const patch = buildUpdateAgentPatch({
      ...allNull,
      name: "Recipe Helper 2",
      mcpServerIds: ["srv-1"],
    });
    const updated = updateAgent(created.id, patch);

    expect(updated.name).toBe("Recipe Helper 2");
    expect(JSON.parse(updated.mcp_server_ids)).toEqual(["srv-1"]);
  });
});

describe("deleteAgent", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("removes a custom agent", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    deleteAgent(created.id);
    expect(listAgents().map((r) => r.id)).not.toContain(created.id);
  });

  it("refuses to delete a system agent", () => {
    expect(() => deleteAgent("configAgent")).toThrow(/system agent and cannot be deleted/);
  });

  it("throws for an unknown id", () => {
    expect(() => deleteAgent("no-such-agent")).toThrow("Unknown agent: no-such-agent");
  });
});

describe("exportAgent / exportAllAgents / importAgent", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("exports a custom agent without id/system/enabled/mcp_server_ids", () => {
    const created = createAgent({ name: "Recipe Helper", tagline: "Cooking", description: "desc", prompt: "p" });
    const exported = exportAgent(created.id);
    expect(exported).toEqual({
      name: "Recipe Helper",
      icon: created.icon,
      tagline: "Cooking",
      description: "desc",
      model: created.model,
      prompt: "p",
    });
  });

  it("refuses to export a system agent", () => {
    expect(() => exportAgent("configAgent")).toThrow(/system agent and cannot be exported/);
  });

  it("throws for an unknown id", () => {
    expect(() => exportAgent("no-such-agent")).toThrow("Unknown agent: no-such-agent");
  });

  it("exportAllAgents returns only custom agents", () => {
    createAgent({ name: "Recipe Helper", prompt: "p" });
    const all = exportAllAgents();
    expect(all.map((a) => a.name)).toEqual(["Recipe Helper"]);
  });

  it("importAgent creates a new agent with a fresh id, ignoring any id/system/enabled in the input", () => {
    const created = importAgent({
      name: "Recipe Helper",
      icon: "ti-robot",
      tagline: "Cooking",
      description: "desc",
      model: "openai/gpt-4.1-mini",
      prompt: "p",
    });
    expect(created.id).toBe("recipe-helper");
    expect(created.system).toBe(0);
    expect(created.enabled).toBe(1);
  });
});

describe("connector attachment (agents.connector_ids)", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("updateAgent persists connectorIds the same way it persists mcpServerIds", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    const patch = buildUpdateAgentPatch({
      name: null,
      tagline: null,
      description: null,
      prompt: null,
      model: null,
      enabled: null,
      mcpServerIds: null,
      connectorIds: ["gmail"],
    });
    const updated = updateAgent(created.id, patch);
    expect(JSON.parse(updated.connector_ids)).toEqual(["gmail"]);
  });

  it("attachConnectorsForRow returns no tools for an agent with no connectors attached", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    const row = listAgents().find((a) => a.id === created.id)!;
    expect(attachConnectorsForRow(row)).toEqual([]);
  });

  it("attachConnectorsForRow builds Gmail's tools once Gmail is attached and connected", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1", refreshToken: "rt-1" });
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    updateAgent(created.id, { connectorIds: ["gmail"] });
    const row = listAgents().find((a) => a.id === created.id)!;

    const tools = attachConnectorsForRow(row);

    expect(tools.map((t) => t.name)).toEqual(["gmail_send_email", "gmail_search_messages"]);
  });

  it("attachConnectorsForRow skips a connector id that's attached but not actually connected", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    updateAgent(created.id, { connectorIds: ["gmail"] });
    const row = listAgents().find((a) => a.id === created.id)!;

    expect(attachConnectorsForRow(row)).toEqual([]);
  });

  it("attachConnectorsForRow skips an unknown connector id without throwing", () => {
    const created = createAgent({ name: "Recipe Helper", prompt: "p" });
    updateAgent(created.id, { connectorIds: ["not-a-real-connector"] });
    const row = listAgents().find((a) => a.id === created.id)!;

    expect(attachConnectorsForRow(row)).toEqual([]);
  });

  it("attachConnectorsForIds builds tools directly from a plain id list (used for the orchestrator, which has no AgentRow)", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1", refreshToken: "rt-1" });

    const tools = attachConnectorsForIds(["gmail"]);

    expect(tools.map((t) => t.name)).toEqual(["gmail_send_email", "gmail_search_messages"]);
  });

  it("attachConnectorsForIds returns no tools for an empty id list", () => {
    expect(attachConnectorsForIds([])).toEqual([]);
  });
});
