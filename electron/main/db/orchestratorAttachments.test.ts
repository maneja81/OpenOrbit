import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({ getDb: () => db }));
vi.mock("../db", () => ({ getDb: () => db }));
vi.mock("../db/index", () => ({ getDb: () => db }));
vi.mock("../devLog", () => ({ devLog: () => {} }));

import { detachFromOrchestrator } from "./orchestratorAttachments";
import { getSetting, setSetting } from "./settingsStore";

describe("detachFromOrchestrator", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  const stored = (key: string) => getSetting<string[]>(`appSettings.${key}`, []);

  it("drops the id and keeps the rest", () => {
    setSetting("appSettings.orchestratorMcpServerIds", ["a", "b", "c"]);
    detachFromOrchestrator("mcp", "b");
    expect(stored("orchestratorMcpServerIds")).toEqual(["a", "c"]);
  });

  it("does nothing when the id was never attached", () => {
    setSetting("appSettings.orchestratorConnectorIds", ["gmail"]);
    detachFromOrchestrator("connector", "drive");
    expect(stored("orchestratorConnectorIds")).toEqual(["gmail"]);
  });

  it("copes with the setting never having been written", () => {
    // A fresh install has no row at all; readAppSetting supplies the default.
    expect(() => detachFromOrchestrator("httpToolCollection", "anything")).not.toThrow();
    expect(stored("orchestratorHttpToolCollectionIds")).toEqual([]);
  });

  it("empties the list when the last attachment goes", () => {
    setSetting("appSettings.orchestratorHttpToolCollectionIds", ["only"]);
    detachFromOrchestrator("httpToolCollection", "only");
    expect(stored("orchestratorHttpToolCollectionIds")).toEqual([]);
  });

  it("touches only its own kind", () => {
    setSetting("appSettings.orchestratorMcpServerIds", ["shared-id"]);
    setSetting("appSettings.orchestratorConnectorIds", ["shared-id"]);
    detachFromOrchestrator("mcp", "shared-id");
    expect(stored("orchestratorMcpServerIds")).toEqual([]);
    expect(stored("orchestratorConnectorIds")).toEqual(["shared-id"]);
  });

  it("recovers rather than throwing if the stored list is corrupt", () => {
    // readAppSetting validates against the schema, so a non-array degrades to the default.
    setSetting("appSettings.orchestratorMcpServerIds", "not-a-list");
    expect(() => detachFromOrchestrator("mcp", "a")).not.toThrow();
  });
});
