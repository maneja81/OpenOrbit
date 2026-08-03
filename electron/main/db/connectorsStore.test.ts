import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

describe("migration 25 — connectors table and agents.connector_ids", () => {
  it("creates the connectors table and an agents.connector_ids column defaulting to '[]'", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare("INSERT INTO connectors (id, type) VALUES (?, ?)").run("gmail", "gmail");
    const connector = db.prepare("SELECT * FROM connectors WHERE id = ?").get("gmail") as {
      status: string;
      credentials: string | null;
    };
    expect(connector.status).toBe("disconnected");
    expect(connector.credentials).toBeNull();

    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "");
    const agent = db.prepare("SELECT connector_ids FROM agents WHERE id = ?").get("agent-1") as {
      connector_ids: string;
    };
    expect(agent.connector_ids).toBe("[]");

    db.close();
  });
});

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

let db: Database.Database;
vi.mock("./index", () => ({
  getDb: () => db,
}));

import {
  listConnectors,
  getConnector,
  getDecryptedCredentials,
  saveConnectorCredentials,
  disconnectConnector,
  getDecryptedSettings,
  saveConnectorSettings,
} from "./connectorsStore";

describe("connectorsStore", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
  });

  afterEach(() => {
    db.close();
  });

  it("saveConnectorCredentials inserts a new connected row and encrypts credentials at rest", () => {
    const row = saveConnectorCredentials(
      "gmail",
      "gmail",
      { accessToken: "at-1", refreshToken: "rt-1", expiresAt: 123, scope: "gmail.send" },
      "user@gmail.com"
    );

    expect(row.status).toBe("connected");
    expect(row.account_label).toBe("user@gmail.com");

    const raw = db.prepare("SELECT credentials FROM connectors WHERE id = ?").get("gmail") as {
      credentials: string;
    };
    expect(raw.credentials.startsWith("enc:")).toBe(true);
    expect(listConnectors()).toHaveLength(1);
  });

  it("getDecryptedCredentials round-trips the stored credentials", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1", refreshToken: "rt-1" });
    expect(getDecryptedCredentials("gmail")).toEqual({ accessToken: "at-1", refreshToken: "rt-1" });
  });

  it("getDecryptedCredentials returns null for an unknown or never-connected connector", () => {
    expect(getDecryptedCredentials("gmail")).toBeNull();
  });

  it("saveConnectorCredentials on an existing row updates in place rather than duplicating", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1" }, "old@gmail.com");
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-2" }, "new@gmail.com");

    expect(listConnectors()).toHaveLength(1);
    expect(getConnector("gmail")?.account_label).toBe("new@gmail.com");
    expect(getDecryptedCredentials("gmail")).toEqual({ accessToken: "at-2" });
  });

  it("disconnectConnector clears credentials and detaches the connector from every agent's connector_ids", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1" });
    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description, connector_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "", JSON.stringify(["gmail", "other-connector"]));

    disconnectConnector("gmail");

    expect(getConnector("gmail")?.status).toBe("disconnected");
    expect(getDecryptedCredentials("gmail")).toBeNull();
    const agent = db.prepare("SELECT connector_ids FROM agents WHERE id = ?").get("agent-1") as {
      connector_ids: string;
    };
    expect(JSON.parse(agent.connector_ids)).toEqual(["other-connector"]);
  });

  it("saveConnectorSettings inserts a row (defaulting to disconnected) and encrypts settings at rest", () => {
    saveConnectorSettings("gmail", "gmail", { clientId: "client-123", clientSecret: "shh" });

    const raw = db.prepare("SELECT status, settings FROM connectors WHERE id = ?").get("gmail") as {
      status: string;
      settings: string;
    };
    expect(raw.status).toBe("disconnected");
    expect(raw.settings.startsWith("enc:")).toBe(true);
    expect(getDecryptedSettings("gmail")).toEqual({ clientId: "client-123", clientSecret: "shh" });
  });

  it("getDecryptedSettings returns null for an unknown or never-configured connector", () => {
    expect(getDecryptedSettings("gmail")).toBeNull();
  });

  it("saveConnectorSettings on an existing row updates settings without disturbing status/credentials", () => {
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1" }, "user@gmail.com");
    saveConnectorSettings("gmail", "gmail", { clientId: "client-1" });
    saveConnectorSettings("gmail", "gmail", { clientId: "client-2" });

    expect(listConnectors()).toHaveLength(1);
    expect(getDecryptedSettings("gmail")).toEqual({ clientId: "client-2" });
    expect(getConnector("gmail")?.status).toBe("connected");
    expect(getDecryptedCredentials("gmail")).toEqual({ accessToken: "at-1" });
  });

  it("disconnectConnector clears credentials but leaves settings intact for reconnect", () => {
    saveConnectorSettings("gmail", "gmail", { clientId: "client-1" });
    saveConnectorCredentials("gmail", "gmail", { accessToken: "at-1" });

    disconnectConnector("gmail");

    expect(getConnector("gmail")?.status).toBe("disconnected");
    expect(getDecryptedCredentials("gmail")).toBeNull();
    expect(getDecryptedSettings("gmail")).toEqual({ clientId: "client-1" });
  });
});
