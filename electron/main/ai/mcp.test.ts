import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../db/migrations";

describe("migration 20 — mcp_servers table and agents.mcp_server_ids", () => {
  it("creates the mcp_servers table and an agents.mcp_server_ids column defaulting to '[]'", () => {
    const db = new Database(":memory:");
    runMigrations(db);

    db.prepare("INSERT INTO mcp_servers (id, name, command) VALUES (?, ?, ?)").run("srv-1", "Server 1", "npx");
    const server = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get("srv-1") as {
      args: string;
      env: string;
      enabled: number;
    };
    expect(server.args).toBe("[]");
    expect(server.env).toBe("{}");
    expect(server.enabled).toBe(1);

    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "");
    const agent = db.prepare("SELECT mcp_server_ids FROM agents WHERE id = ?").get("agent-1") as {
      mcp_server_ids: string;
    };
    expect(agent.mcp_server_ids).toBe("[]");

    db.close();
  });
});

vi.mock("../security/secretStorage", () => ({
  encryptSecret: (v: string) => `enc:${v}`,
  decryptSecret: (v: string) => v.replace(/^enc:/, ""),
}));

const connectMock = vi.fn();
const closeMock = vi.fn();
const listToolsMock = vi.fn();
let lastConstructedOptions: Record<string, unknown> | null = null;

vi.mock("@openai/agents", () => ({
  MCPServerStdio: class {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      lastConstructedOptions = options;
    }
    connect = connectMock;
    close = closeMock;
    listTools = listToolsMock;
  },
}));

let db: Database.Database;
vi.mock("../db", () => ({
  getDb: () => db,
}));

import {
  listMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  connectMcpServersForAgent,
} from "./mcp";

describe("MCP server CRUD", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    connectMock.mockReset().mockResolvedValue(undefined);
    closeMock.mockReset().mockResolvedValue(undefined);
    listToolsMock.mockReset().mockResolvedValue([]);
    lastConstructedOptions = null;
  });

  afterEach(() => {
    db.close();
  });

  it("createMcpServer slugifies the name into an id and encrypts env values at rest", () => {
    const created = createMcpServer({
      name: "My Cool Server!",
      command: "npx",
      args: ["-y", "@foo/bar"],
      env: { API_KEY: "secret-value" },
    });

    expect(created.id).toBe("my-cool-server");
    expect(JSON.parse(created.args)).toEqual(["-y", "@foo/bar"]);
    expect(JSON.parse(created.env)).toEqual({ API_KEY: "enc:secret-value" });
    expect(listMcpServers()).toHaveLength(1);
  });

  it("createMcpServer de-dupes ids for repeated names", () => {
    createMcpServer({ name: "Server", command: "npx" });
    const second = createMcpServer({ name: "Server", command: "npx" });
    expect(second.id).toBe("server-2");
  });

  it("createMcpServer rejects an empty name or command", () => {
    expect(() => createMcpServer({ name: "", command: "npx" })).toThrow("MCP server name is required.");
    expect(() => createMcpServer({ name: "Server", command: "" })).toThrow("MCP server command is required.");
  });

  it("updateMcpServer patches only the provided fields", () => {
    const created = createMcpServer({ name: "Server", command: "npx", env: { A: "1" } });
    const updated = updateMcpServer(created.id, { enabled: false });
    expect(updated.enabled).toBe(0);
    expect(updated.command).toBe("npx");
    expect(JSON.parse(updated.env)).toEqual({ A: "enc:1" });
  });

  it("deleteMcpServer removes the row and detaches it from any agent's mcp_server_ids", () => {
    const created = createMcpServer({ name: "Server", command: "npx" });
    db.prepare(
      "INSERT INTO agents (id, name, prompt, model, icon, tagline, description, mcp_server_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("agent-1", "Agent", "prompt", "model", "icon", "", "", JSON.stringify([created.id, "other-server"]));

    deleteMcpServer(created.id);

    expect(listMcpServers()).toEqual([]);
    const agent = db.prepare("SELECT mcp_server_ids FROM agents WHERE id = ?").get("agent-1") as {
      mcp_server_ids: string;
    };
    expect(JSON.parse(agent.mcp_server_ids)).toEqual(["other-server"]);
  });
});

describe("connectMcpServersForAgent", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    connectMock.mockReset();
    closeMock.mockReset();
    lastConstructedOptions = null;
  });

  afterEach(() => {
    db.close();
  });

  it("returns an empty array without touching the DB when given no ids", async () => {
    const servers = await connectMcpServersForAgent([]);
    expect(servers).toEqual([]);
  });

  it("connects each enabled attached server, decrypting its env, and skips disabled ones", async () => {
    connectMock.mockResolvedValue(undefined);
    const enabled = createMcpServer({ name: "Enabled", command: "npx", env: { KEY: "value" } });
    const disabled = createMcpServer({ name: "Disabled", command: "npx" });
    updateMcpServer(disabled.id, { enabled: false });

    const servers = await connectMcpServersForAgent([enabled.id, disabled.id]);

    expect(servers).toHaveLength(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(lastConstructedOptions?.env).toEqual({ KEY: "value" });
  });

  it("logs and skips a server whose connect() throws, without failing the whole call", async () => {
    connectMock.mockRejectedValue(new Error("spawn failed"));
    const server = createMcpServer({ name: "Broken", command: "npx" });

    const servers = await connectMcpServersForAgent([server.id]);

    expect(servers).toEqual([]);
  });
});
