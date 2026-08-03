import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath },
}));

const runMigrationsMock = vi.hoisted(() => vi.fn());
vi.mock("./migrations", () => ({ runMigrations: runMigrationsMock }));

let parent = "";

beforeEach(() => {
  vi.resetModules();
  runMigrationsMock.mockReset();
  parent = mkdtempSync(path.join(os.tmpdir(), "db-index-"));
  state.userDataPath = path.join(parent, "OpenOrbit");
  mkdirSync(path.join(state.userDataPath, "database"), { recursive: true });
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe("getDb", () => {
  // KI-3: `db` used to be assigned before runMigrations ran, so a throwing migration left
  // the module-level singleton set to a half-migrated handle — every call after the first
  // returned it silently via the `if (db) return db` guard instead of retrying.
  it("does not cache the handle when migrations fail, so the next call retries", async () => {
    runMigrationsMock.mockImplementationOnce(() => {
      throw new Error("migration boom");
    });
    const { getDb } = await import("./index");

    expect(() => getDb()).toThrow("migration boom");
    expect(runMigrationsMock).toHaveBeenCalledTimes(1);

    // Second call must attempt migrations again, not return a cached half-migrated db.
    runMigrationsMock.mockImplementationOnce(() => {});
    const db = getDb();
    expect(runMigrationsMock).toHaveBeenCalledTimes(2);
    expect(db).toBeTruthy();
  });

  it("caches the handle once migrations succeed", async () => {
    runMigrationsMock.mockImplementation(() => {});
    const { getDb } = await import("./index");

    const first = getDb();
    const second = getDb();
    expect(second).toBe(first);
    expect(runMigrationsMock).toHaveBeenCalledTimes(1);
  });
});
