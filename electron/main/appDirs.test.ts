import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const state = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => state.userDataPath },
}));

vi.mock("./devLog", () => ({ devLog: vi.fn() }));

import { ensureAppDirectories, getLegacyAppRoots, migrateLegacyUserData } from "./appDirs";

let parent = "";

/** Writes a file at `relativePath` under `root`, creating parent directories as needed. */
function seed(root: string, relativePath: string, contents: string): void {
  const target = path.join(root, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

beforeEach(() => {
  parent = mkdtempSync(path.join(os.tmpdir(), "appdirs-"));
  state.userDataPath = path.join(parent, "OpenOrbit");
  mkdirSync(state.userDataPath, { recursive: true });
});

afterEach(() => {
  rmSync(parent, { recursive: true, force: true });
});

describe("getLegacyAppRoots", () => {
  it("lists every prior userData root, newest-first, as siblings of the current one", () => {
    expect(getLegacyAppRoots()).toEqual([
      path.join(parent, "Agents"),
      path.join(parent, "agents"),
      path.join(parent, "alex"),
    ]);
  });

  it("never includes the current root", () => {
    // A build still named "Agents" would otherwise try to migrate its own data onto itself.
    state.userDataPath = path.join(parent, "Agents");
    expect(getLegacyAppRoots()).not.toContain(state.userDataPath);
    expect(getLegacyAppRoots()).toEqual([path.join(parent, "agents"), path.join(parent, "alex")]);
  });
});

describe("migrateLegacyUserData", () => {
  it("moves every app-owned directory from the legacy root into the current one", () => {
    const legacy = path.join(parent, "Agents");
    seed(legacy, "database/agents.db", "db");
    seed(legacy, "knowledge-files/doc.md", "hello");
    seed(legacy, "mcp/config.json", "{}");
    seed(legacy, "user-info/facts.json", "[]");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "database/agents.db"), "utf-8")).toBe("db");
    expect(readFileSync(path.join(state.userDataPath, "knowledge-files/doc.md"), "utf-8")).toBe("hello");
    expect(readFileSync(path.join(state.userDataPath, "mcp/config.json"), "utf-8")).toBe("{}");
    expect(readFileSync(path.join(state.userDataPath, "user-info/facts.json"), "utf-8")).toBe("[]");
  });

  it("leaves the legacy root in place rather than deleting a user's only copy", () => {
    const legacy = path.join(parent, "Agents");
    seed(legacy, "database/agents.db", "db");

    migrateLegacyUserData();

    expect(existsSync(legacy)).toBe(true);
  });

  it("prefers the newest legacy root when more than one exists", () => {
    seed(path.join(parent, "Agents"), "database/agents.db", "newer");
    seed(path.join(parent, "alex"), "database/agents.db", "older");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "database/agents.db"), "utf-8")).toBe("newer");
  });

  it("leaves a database already at the current root alone", () => {
    seed(state.userDataPath, "database/agents.db", "current");
    seed(path.join(parent, "Agents"), "database/agents.db", "legacy");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "database/agents.db"), "utf-8")).toBe("current");
  });

  it("still migrates a directory left behind after the database has already moved", () => {
    // A directory whose move failed once — a permissions blip, a destination that was
    // briefly non-empty — has to get another chance on the next launch. Migration v31
    // rewrites knowledge_files.path to the new root regardless, so a knowledge-files
    // directory stranded at the old root means rows pointing at files that aren't there.
    seed(state.userDataPath, "database/agents.db", "already migrated");
    seed(path.join(parent, "Agents"), "knowledge-files/doc.md", "left behind");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "knowledge-files/doc.md"), "utf-8")).toBe("left behind");
  });

  it("is inert on every launch after a completed migration", () => {
    seed(path.join(parent, "Agents"), "database/agents.db", "db");
    migrateLegacyUserData();

    // The legacy root survives (Chromium keeps its own folders there), so the second pass
    // still finds it — every app-owned source is gone, so there is nothing left to do.
    expect(() => migrateLegacyUserData()).not.toThrow();
    expect(readFileSync(path.join(state.userDataPath, "database/agents.db"), "utf-8")).toBe("db");
  });

  it("migrates through the empty directories a prior launch may have created", () => {
    // ensureAppDirectories() runs on every launch, so a build that started once before the
    // migration existed leaves empty folders at the new root. They must not block the move.
    ensureAppDirectories();
    seed(path.join(parent, "Agents"), "knowledge-files/doc.md", "hello");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "knowledge-files/doc.md"), "utf-8")).toBe("hello");
  });

  it("never clobbers a destination directory that already has data in it", () => {
    seed(state.userDataPath, "knowledge-files/mine.md", "keep me");
    seed(path.join(parent, "Agents"), "knowledge-files/theirs.md", "legacy");

    migrateLegacyUserData();

    expect(readFileSync(path.join(state.userDataPath, "knowledge-files/mine.md"), "utf-8")).toBe("keep me");
    expect(existsSync(path.join(state.userDataPath, "knowledge-files/theirs.md"))).toBe(false);
  });

  it("does nothing when there is no legacy root at all", () => {
    expect(() => migrateLegacyUserData()).not.toThrow();
    expect(existsSync(path.join(state.userDataPath, "database"))).toBe(false);
  });
});
