import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));

const devLogMock = vi.hoisted(() => vi.fn());
vi.mock("../devLog", () => ({ devLog: devLogMock }));

import { getSetting, setSetting, getSettingsByPrefix, deleteSettingsByPrefix } from "./settingsStore";

/** Writes a raw string straight into setting_value, bypassing setSetting's JSON.stringify —
 * the only way to reproduce a row that isn't valid JSON (partial write, hand-edited DB, or a
 * value written by a path that forgot to stringify). */
function writeRawValue(name: string, raw: string): void {
  db.prepare("INSERT INTO settings (setting_name, setting_value) VALUES (?, ?)").run(name, raw);
}

// A prefix of its own rather than the real "appSettings." — migrations seed rows under that
// namespace, so asserting on the whole object would break every time a seed is added.
const PREFIX = "storeTest.";

describe("settingsStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    devLogMock.mockClear();
  });

  describe("getSetting", () => {
    it("round-trips a value through setSetting", () => {
      setSetting(`${PREFIX}limit`, 20);
      expect(getSetting(`${PREFIX}limit`, 5)).toBe(20);
    });

    it("returns the default when the row does not exist", () => {
      expect(getSetting(`${PREFIX}missing`, "fallback")).toBe("fallback");
    });

    it("overwrites on a second write rather than inserting twice", () => {
      setSetting(`${PREFIX}limit`, 20);
      setSetting(`${PREFIX}limit`, 40);
      expect(getSetting(`${PREFIX}limit`, 5)).toBe(40);
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM settings WHERE setting_name = ?").get(`${PREFIX}limit`)
      ).toEqual({ n: 1 });
    });

    it("falls back to the default when the stored value is not valid JSON", () => {
      writeRawValue(`${PREFIX}broken`, "{not json");
      expect(getSetting(`${PREFIX}broken`, "fallback")).toBe("fallback");
    });

    it("does not throw on an unparseable row", () => {
      writeRawValue(`${PREFIX}broken`, "");
      expect(() => getSetting(`${PREFIX}broken`, 0)).not.toThrow();
    });

    it("keeps a stored null distinct from a corrupt row", () => {
      // `null` is a legitimate stored value, so it must survive as null rather than being
      // mistaken for "unparseable" and replaced by the default.
      setSetting(`${PREFIX}explicitNull`, null);
      expect(getSetting(`${PREFIX}explicitNull`, "fallback")).toBeNull();
    });

    it("preserves falsy values instead of substituting the default", () => {
      setSetting(`${PREFIX}off`, false);
      setSetting(`${PREFIX}zero`, 0);
      setSetting(`${PREFIX}empty`, "");
      expect(getSetting(`${PREFIX}off`, true)).toBe(false);
      expect(getSetting(`${PREFIX}zero`, 99)).toBe(0);
      expect(getSetting(`${PREFIX}empty`, "x")).toBe("");
    });

    it("round-trips arrays and objects", () => {
      setSetting(`${PREFIX}ids`, ["a", "b"]);
      expect(getSetting<string[]>(`${PREFIX}ids`, [])).toEqual(["a", "b"]);
    });
  });

  describe("getSettingsByPrefix", () => {
    it("returns every matching row keyed with the prefix stripped", () => {
      setSetting(`${PREFIX}alpha`, 1);
      setSetting(`${PREFIX}beta`, "two");
      expect(getSettingsByPrefix(PREFIX)).toEqual({ alpha: 1, beta: "two" });
    });

    it("excludes rows outside the prefix", () => {
      setSetting(`${PREFIX}alpha`, 1);
      setSetting("other.alpha", 2);
      expect(getSettingsByPrefix(PREFIX)).toEqual({ alpha: 1 });
    });

    it("skips an unparseable row and still returns the rest", () => {
      // The whole point of the guard: one bad row used to throw here, which made settings:get
      // reject, which made the renderer fall back to *every* default — reading as a wiped config.
      setSetting(`${PREFIX}alpha`, 1);
      writeRawValue(`${PREFIX}broken`, "{not json");
      setSetting(`${PREFIX}beta`, "two");

      expect(getSettingsByPrefix(PREFIX)).toEqual({ alpha: 1, beta: "two" });
    });

    it("omits the bad key entirely rather than setting it to undefined", () => {
      // mergeWithDefaults spreads this object over the defaults, so an explicit `undefined`
      // key would override the default it is supposed to fall back to.
      writeRawValue(`${PREFIX}broken`, "{not json");
      expect("broken" in getSettingsByPrefix(PREFIX)).toBe(false);
    });

    it("does not throw when every row is unparseable", () => {
      writeRawValue(`${PREFIX}a`, "{");
      writeRawValue(`${PREFIX}b`, "undefined");
      expect(getSettingsByPrefix(PREFIX)).toEqual({});
    });

    it("returns an empty object when nothing matches", () => {
      expect(getSettingsByPrefix(PREFIX)).toEqual({});
    });
  });

  describe("logging a skipped row", () => {
    it("names the key and its size so the row can be found", () => {
      writeRawValue(`${PREFIX}broken`, "{not json");
      getSetting(`${PREFIX}broken`, null);

      const line = String(devLogMock.mock.calls.at(-1)?.[0]);
      expect(line).toContain(`${PREFIX}broken`);
      expect(line).toContain("9 bytes");
    });

    it("never echoes the stored value", () => {
      // devLog writes to userData/debug.log — the file users attach to bug reports. JSON.parse's
      // own message quotes up to ~30 characters of its input ("Unexpected token 'h',
      // \"https://ap\"… is not valid JSON"), so a half-written appSettings.chatApiUrl row would
      // put credentials on disk if the raw error were logged. Assert on a value that looks like
      // one, so a regression here fails loudly rather than leaking quietly.
      const secret = "https://api.example.com/v1?api_key=SUPERSECRETVALUE";
      writeRawValue("appSettings.chatApiUrl", secret);

      getSettingsByPrefix("appSettings.");

      const logged = devLogMock.mock.calls.map((call) => String(call[0])).join("\n");
      expect(logged).toContain("appSettings.chatApiUrl");
      expect(logged).not.toContain("SUPERSECRETVALUE");
      // Not just the secret — no leading fragment of the value either, which is the form
      // JSON.parse's message actually takes.
      expect(logged).not.toContain("https://");
    });

    it("says nothing when every row parses", () => {
      setSetting(`${PREFIX}fine`, 1);
      getSettingsByPrefix(PREFIX);
      expect(devLogMock).not.toHaveBeenCalled();
    });
  });

  describe("deleteSettingsByPrefix", () => {
    it("removes only the rows under the prefix", () => {
      setSetting(`${PREFIX}alpha`, 1);
      setSetting("other.alpha", 2);

      deleteSettingsByPrefix(PREFIX);

      expect(getSettingsByPrefix(PREFIX)).toEqual({});
      expect(getSetting("other.alpha", null)).toBe(2);
    });

    it("removes unparseable rows too, so a corrupt row can be cleared", () => {
      writeRawValue(`${PREFIX}broken`, "{not json");
      deleteSettingsByPrefix(PREFIX);
      expect(db.prepare("SELECT COUNT(*) AS n FROM settings WHERE setting_name LIKE ?").get(`${PREFIX}%`)).toEqual({
        n: 0,
      });
    });
  });
});
