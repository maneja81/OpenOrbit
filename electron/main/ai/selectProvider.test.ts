/**
 * @vitest-environment node
 *
 * Main-process code; see provider.test.ts for why jsdom is the wrong environment here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));
vi.mock("../devLog", () => ({ devLog: () => {} }));

let db: Database.Database;
vi.mock("../db", () => ({ getDb: () => db }));
vi.mock("../db/index", () => ({ getDb: () => db }));

import { selectChatProvider } from "./selectProvider";
import { getProviderCredentials } from "../db/providersStore";

function seedAgent(id: string, model: string, providerId = ""): void {
  db.prepare(
    "INSERT INTO agents (id, name, prompt, model, icon, tagline, description, provider_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, id, "prompt", model, "ti-robot", "", "", providerId);
}

function setting(name: string): unknown {
  const row = db.prepare("SELECT setting_value FROM settings WHERE setting_name = ?").get(name) as
    | { setting_value: string }
    | undefined;
  return row ? JSON.parse(row.setting_value) : undefined;
}

function modelOf(id: string): string {
  return (db.prepare("SELECT model FROM agents WHERE id = ?").get(id) as { model: string }).model;
}

describe("selectChatProvider", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  it("stores the credentials, points the slot, and records the model", () => {
    const result = selectChatProvider({
      providerId: "anthropic",
      apiKey: "sk-ant",
    });
    expect(result).toEqual({ providerId: "anthropic", model: "claude-haiku-4-5-20251001", updatedAgents: 0 });
    expect(getProviderCredentials("anthropic")).toEqual({
      apiUrl: "https://api.anthropic.com/v1",
      apiKey: "sk-ant",
    });
    expect(setting("appSettings.chatProviderId")).toBe("anthropic");
    expect(setting("appSettings.orchestratorModel")).toBe("claude-haiku-4-5-20251001");
  });

  it("re-points agents that inherit the Chat slot", () => {
    seedAgent("configAgent", "gpt-4.1-mini");
    seedAgent("knowledgeAgent", "gpt-4.1-mini");
    const result = selectChatProvider({ providerId: "anthropic", apiKey: "sk-ant" });
    // The whole reason this function exists: leaving them on an OpenAI id makes all four system
    // agents 404 against the new host, for agents the user never configured.
    expect(result.updatedAgents).toBe(2);
    expect(modelOf("configAgent")).toBe("claude-haiku-4-5-20251001");
    expect(modelOf("knowledgeAgent")).toBe("claude-haiku-4-5-20251001");
  });

  it("leaves an agent that carries its own provider alone", () => {
    seedAgent("configAgent", "gpt-4.1-mini");
    seedAgent("explorerAgent", "claude-haiku-4-5-20251001", "anthropic");
    selectChatProvider({ providerId: "openrouter", apiKey: "sk-or" });
    // That agent was pinned deliberately. Rewriting it would undo the user's own decision to run
    // one agent somewhere else — which is the entire feature.
    expect(modelOf("explorerAgent")).toBe("claude-haiku-4-5-20251001");
    expect(modelOf("configAgent")).toBe("~deepseek/deepseek-v4-flash-latest");
  });

  it("does not count agents that already hold the target model", () => {
    seedAgent("configAgent", "claude-haiku-4-5-20251001");
    // Reported to the user as "N agents updated", so a no-op switch must not claim to have
    // changed anything.
    expect(selectChatProvider({ providerId: "anthropic", apiKey: "sk-ant" }).updatedAgents).toBe(0);
  });

  it("accepts a custom model and URL over the provider's defaults", () => {
    const result = selectChatProvider({
      providerId: "openrouter",
      apiUrl: "https://proxy.example.com/v1",
      apiKey: "sk-or",
      model: "openai/gpt-4.1-mini",
    });
    expect(result.model).toBe("openai/gpt-4.1-mini");
    expect(getProviderCredentials("openrouter")?.apiUrl).toBe("https://proxy.example.com/v1");
  });

  it("takes an Ollama name:tag model", () => {
    const result = selectChatProvider({
      providerId: "local",
      apiUrl: "http://localhost:11434/v1",
      model: "llama3.2:3b",
    });
    expect(result.model).toBe("llama3.2:3b");
  });

  describe("refuses what cannot work", () => {
    it("an unknown provider", () => {
      expect(() => selectChatProvider({ providerId: "gemini" })).toThrow(/Unknown provider/);
    });

    it("a local server with no URL — nobody else knows the address", () => {
      expect(() => selectChatProvider({ providerId: "local", model: "llama3.2:3b" })).toThrow(/needs an API URL/);
    });

    it("a local server with no model — there is no sensible default", () => {
      expect(() => selectChatProvider({ providerId: "local", apiUrl: "http://localhost:11434/v1" })).toThrow(
        /needs a model id/
      );
    });

    it("an explicitly blank key on a provider that requires one", () => {
      // Distinct from omitting it, which means "leave the stored key alone".
      expect(() => selectChatProvider({ providerId: "anthropic", apiKey: "   " })).toThrow(/needs an API key/);
    });

    it("a blank key on the one provider that does not require one", () => {
      expect(() =>
        selectChatProvider({ providerId: "local", apiUrl: "http://localhost:11434/v1", model: "llama3.2:3b", apiKey: "" })
      ).not.toThrow();
    });

    it("a malformed URL", () => {
      expect(() => selectChatProvider({ providerId: "openai", apiUrl: "not a url", apiKey: "sk-x" })).toThrow(
        /API URL/
      );
    });

    it("a model id the write boundary would refuse", () => {
      expect(() =>
        selectChatProvider({ providerId: "openai", apiKey: "sk-x", model: "has spaces" })
      ).toThrow(/model id/);
    });

    it("leaves everything untouched when it refuses", () => {
      seedAgent("configAgent", "gpt-4.1-mini");
      expect(() => selectChatProvider({ providerId: "openai", apiKey: "sk-x", model: "has spaces" })).toThrow();
      // A half-applied switch is worse than a refused one: credentials saved but agents not moved
      // would be the same broken state this function exists to prevent.
      expect(setting("appSettings.chatProviderId")).toBeUndefined();
      expect(modelOf("configAgent")).toBe("gpt-4.1-mini");
      expect(getProviderCredentials("openai")).toBeNull();
    });
  });
});
