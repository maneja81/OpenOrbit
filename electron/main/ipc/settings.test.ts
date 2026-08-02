import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

/** Stands in for the settings table. setSetting writes here; getSettingsByPrefix reads back. */
const stored = new Map<string, unknown>();

vi.mock("../db/settingsStore", () => ({
  setSetting: vi.fn((name: string, value: unknown) => {
    stored.set(name, value);
  }),
  getSettingsByPrefix: vi.fn((prefix: string) => {
    const result: Record<string, unknown> = {};
    for (const [name, value] of stored) {
      if (name.startsWith(prefix)) result[name.slice(prefix.length)] = value;
    }
    return result;
  }),
}));

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (plain: string) => `nodeCrypto:${plain}`,
  decryptSecret: (blob: string) => blob.replace(/^nodeCrypto:/, ""),
}));

// Mocked rather than imported: the real modules reach the Electron app object and the agents
// SDK, neither of which exists here, and neither is what these tests are about.
vi.mock("../db", () => ({ getDb: vi.fn() }));
vi.mock("../db/migrations", () => ({ runMigrations: vi.fn() }));
vi.mock("../ai/agents", () => ({ DEFAULT_MODEL: "gpt-4.1-mini" }));
vi.mock("../ai/provider", () => ({ testChatConnection: vi.fn(), testVoiceConnection: vi.fn() }));

const devLogMock = vi.hoisted(() => vi.fn());
vi.mock("../devLog", () => ({ devLog: devLogMock }));

import { ipcMain } from "electron";
import { registerSettingsHandlers } from "./settings";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlerFor(channel: string): Handler {
  registerSettingsHandlers();
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} was never registered`);
  return call[1] as Handler;
}

function update(patch: Record<string, unknown>): Record<string, unknown> {
  return handlerFor("settings:update")(null, patch) as Record<string, unknown>;
}

describe("settings:update", () => {
  beforeEach(() => {
    stored.clear();
    vi.mocked(ipcMain.handle).mockClear();
    devLogMock.mockClear();
  });

  it("rejects a patch that isn't a plain object", () => {
    expect(() => handlerFor("settings:update")(null, [])).toThrow("plain object");
    expect(() => handlerFor("settings:update")(null, null)).toThrow("plain object");
  });

  it("persists a valid value and returns the post-write state", () => {
    const result = update({ userName: "Ada" });
    expect(stored.get("appSettings.userName")).toBe("Ada");
    expect(result.userName).toBe("Ada");
  });

  describe("keys it has never heard of", () => {
    it("does not persist them", () => {
      // The handler used to JSON.stringify anything it was handed straight into the table, so
      // a typo'd key became a real row that nothing would ever read.
      update({ someFutureField: "x" });
      expect(stored.has("appSettings.someFutureField")).toBe(false);
      expect(stored.size).toBe(0);
    });

    it("still writes the valid entries alongside them", () => {
      update({ someFutureField: "x", userName: "Ada" });
      expect(stored.get("appSettings.userName")).toBe("Ada");
      expect(stored.has("appSettings.someFutureField")).toBe(false);
    });

    it("says why in the log", () => {
      update({ someFutureField: "x" });
      const logged = devLogMock.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("refused");
      expect(logged).toContain("someFutureField");
    });
  });

  describe("values of the wrong type", () => {
    it("refuses a string where a boolean belongs", () => {
      // "false" is truthy, so persisting it would silently turn the setting on.
      update({ locationEnabled: "false" });
      expect(stored.has("appSettings.locationEnabled")).toBe(false);
    });

    it("refuses a number below the floor the UI claims", () => {
      update({ systemStatsPollIntervalMs: 1 });
      expect(stored.has("appSettings.systemStatsPollIntervalMs")).toBe(false);
    });

    it("refuses a model id that cannot be one", () => {
      update({ orchestratorModel: "not a model!" });
      expect(stored.has("appSettings.orchestratorModel")).toBe(false);
    });

    it("leaves an already-stored value alone when a later write is refused", () => {
      update({ chatHistoryMessageLimit: 40 });
      update({ chatHistoryMessageLimit: 100_000 });
      expect(stored.get("appSettings.chatHistoryMessageLimit")).toBe(40);
    });
  });

  describe("API keys", () => {
    it("encrypts on the way in and decrypts on the way out", () => {
      const result = update({ chatApiKey: "sk-secret" });
      expect(stored.get("appSettings.chatApiKey")).toBe("nodeCrypto:sk-secret");
      expect(result.chatApiKey).toBe("sk-secret");
    });

    it("never writes the key to the log", () => {
      update({ chatApiKey: "sk-secret" });
      expect(devLogMock.mock.calls.map((c) => String(c[0])).join("\n")).not.toContain("sk-secret");
    });

    it("never writes an API URL to the log either", () => {
      // devLog lands in userData/debug.log, which users attach to bug reports, and some
      // OpenAI-compatible hosts carry the credential in the URL's query string.
      update({ chatApiUrl: "https://host/v1?api_key=SUPERSECRETVALUE" });
      const logged = devLogMock.mock.calls.map((c) => String(c[0])).join("\n");
      expect(logged).toContain("chatApiUrl");
      expect(logged).not.toContain("SUPERSECRETVALUE");
    });
  });

  describe("orchestratorModel", () => {
    it("falls back to the default when cleared", () => {
      update({ orchestratorModel: "" });
      expect(stored.get("appSettings.orchestratorModel")).toBe("gpt-4.1-mini");
    });

    it("trims a valid id", () => {
      update({ orchestratorModel: "  openai/gpt-4.1-mini  " });
      expect(stored.get("appSettings.orchestratorModel")).toBe("openai/gpt-4.1-mini");
    });
  });

  it("silently drops locked keys", () => {
    // The orchestrator is singular and cannot be turned off — enforced here, not just greyed
    // out in the UI, so no caller can reach it.
    update({ orchestratorEnabled: false });
    expect(stored.has("appSettings.orchestratorEnabled")).toBe(false);
  });
});
