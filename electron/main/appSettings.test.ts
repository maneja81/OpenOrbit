import { beforeEach, describe, expect, it, vi } from "vitest";

/** Stands in for the settings table. Values are stored already-parsed, which is what
 * getSetting returns after jsonColumn has done its work. */
const stored = new Map<string, unknown>();

vi.mock("./db/settingsStore", () => ({
  getSetting: vi.fn((name: string, fallback: unknown) => (stored.has(name) ? stored.get(name) : fallback)),
}));

const devLogMock = vi.hoisted(() => vi.fn());
vi.mock("./devLog", () => ({ devLog: devLogMock }));

import { readAppSetting } from "./appSettings";

function store(key: string, value: unknown): void {
  stored.set(`appSettings.${key}`, value);
}

describe("readAppSetting", () => {
  beforeEach(() => {
    stored.clear();
    devLogMock.mockClear();
  });

  it("returns a stored value that matches its declared shape", () => {
    store("agentRunTimeoutSeconds", 120);
    expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(120);
  });

  it("returns the fallback when the row is absent", () => {
    expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(60);
  });

  it("says nothing for an absent row", () => {
    // The normal state of a setting nobody has touched — logging it would bury the real ones.
    readAppSetting("agentRunTimeoutSeconds", 60);
    expect(devLogMock).not.toHaveBeenCalled();
  });

  describe("a stored value the type annotation lied about", () => {
    it("falls back when the row holds a string where a number belongs", () => {
      // getSetting<number> is an assertion, not a check — nothing stopped this before.
      store("agentRunTimeoutSeconds", "60");
      expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(60);
    });

    it("falls back on null", () => {
      store("chatHistoryMessageLimit", null);
      expect(readAppSetting("chatHistoryMessageLimit", 20)).toBe(20);
    });

    it("falls back on NaN and Infinity", () => {
      store("chatHistoryMessageLimit", Number.NaN);
      expect(readAppSetting("chatHistoryMessageLimit", 20)).toBe(20);
      store("chatHistoryMessageLimit", Number.POSITIVE_INFINITY);
      expect(readAppSetting("chatHistoryMessageLimit", 20)).toBe(20);
    });

    it("logs which setting was unusable, without the value", () => {
      store("chatApiUrl", 42);
      readAppSetting("chatApiUrl", "");
      const line = String(devLogMock.mock.calls.at(-1)?.[0]);
      expect(line).toContain("chatApiUrl");
      expect(line).not.toContain("42");
    });
  });

  describe("out-of-range numbers written before the write-side schema existed", () => {
    it("rejects a poll interval that would peg a core", () => {
      // 1 ms was reachable through the old settings:update, which validated nothing. Rows like
      // this survive in databases written by earlier builds.
      store("systemStatsPollIntervalMs", 1);
      expect(readAppSetting("systemStatsPollIntervalMs", 3000)).toBe(3000);
    });

    it("rejects a run timeout below the floor and above the ceiling", () => {
      store("agentRunTimeoutSeconds", 1);
      expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(60);
      store("agentRunTimeoutSeconds", 600_000);
      expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(60);
    });

    it("rejects a zero or negative history limit", () => {
      store("chatHistoryMessageLimit", 0);
      expect(readAppSetting("chatHistoryMessageLimit", 20)).toBe(20);
      store("chatHistoryMessageLimit", -5);
      expect(readAppSetting("chatHistoryMessageLimit", 20)).toBe(20);
    });

    it("keeps a value that sits exactly on a bound", () => {
      store("systemStatsPollIntervalMs", 500);
      expect(readAppSetting("systemStatsPollIntervalMs", 3000)).toBe(500);
      store("agentRunTimeoutSeconds", 5);
      expect(readAppSetting("agentRunTimeoutSeconds", 60)).toBe(5);
    });
  });

  it("preserves falsy values rather than mistaking them for absent", () => {
    store("locationEnabled", false);
    expect(readAppSetting("locationEnabled", true)).toBe(false);
    store("bgMusicVolume", 0);
    expect(readAppSetting("bgMusicVolume", 0.1)).toBe(0);
    store("userName", "");
    expect(readAppSetting("userName", "fallback")).toBe("");
  });
});
