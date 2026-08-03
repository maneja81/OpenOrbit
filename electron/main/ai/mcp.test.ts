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
  searchMcpRegistry,
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

// Trimmed to the fields the parser reads, but the *structure* is copied verbatim from a live
// registry.modelcontextprotocol.io/v0/servers?search=filesystem response (2026-08-02). The
// `{ server, _meta }` nesting is the whole point of this fixture: reading name/packages off the
// wrapper instead of `server` returned zero results for every query in production, and the two
// tests that existed at the time passed throughout because neither called this function.
const REGISTRY_PAGE = {
  servers: [
    {
      server: {
        name: "com.pulsemcp/remote-filesystem",
        description: "MCP server for remote filesystem operations on cloud storage.",
        packages: [
          {
            registryType: "npm",
            identifier: "remote-filesystem-mcp-server",
            transport: { type: "stdio" },
            runtimeArguments: [{ value: "-y", type: "positional" }],
            environmentVariables: [
              { name: "GCS_BUCKET", description: "Bucket name.", isRequired: true },
              { name: "GCS_PROJECT_ID", description: "Project ID." },
            ],
          },
        ],
      },
      _meta: { "io.modelcontextprotocol.registry/official": { isLatest: true } },
    },
    {
      server: {
        name: "io.github.bytedance/mcp-server-filesystem",
        description: "MCP server for filesystem access",
        packages: [
          {
            registryType: "npm",
            identifier: "@agent-infra/mcp-server-filesystem",
            transport: { type: "stdio" },
          },
        ],
      },
      _meta: { "io.modelcontextprotocol.registry/official": { isLatest: true } },
    },
    {
      server: {
        name: "io.github.example/py-only",
        description: "Published for pypi only",
        packages: [{ registryType: "pypi", identifier: "py-only-mcp", transport: { type: "stdio" } }],
      },
      _meta: { "io.modelcontextprotocol.registry/official": { isLatest: true } },
    },
  ],
};

function stubRegistry(page: unknown, response: Partial<{ ok: boolean; status: number; statusText: string }> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok ?? true,
    status: response.status ?? 200,
    statusText: response.statusText ?? "OK",
    json: async () => page,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("searchMcpRegistry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads each entry through `server`, not off the wrapper", async () => {
    stubRegistry(REGISTRY_PAGE);

    const results = await searchMcpRegistry("filesystem");

    // The regression guard: this returned [] for every query while the endpoint answered 200
    // with 30 servers.
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual([
      "com.pulsemcp/remote-filesystem",
      "io.github.bytedance/mcp-server-filesystem",
    ]);
    expect(results[0].description).toBe("MCP server for remote filesystem operations on cloud storage.");
  });

  it("emits -y exactly once, before the package identifier", async () => {
    stubRegistry(REGISTRY_PAGE);

    const results = await searchMcpRegistry("filesystem");

    // The registry supplied `-y` itself for the first server and nothing for the second; both
    // must come out identical. Appending runtimeArguments after the identifier, as this used to,
    // produced `npx -y remote-filesystem-mcp-server -y`.
    expect(results[0].args).toEqual(["-y", "remote-filesystem-mcp-server"]);
    expect(results[1].args).toEqual(["-y", "@agent-infra/mcp-server-filesystem"]);
  });

  it("puts packageArguments after the identifier and runtimeArguments before it", async () => {
    stubRegistry({
      servers: [
        {
          server: {
            name: "example/with-args",
            packages: [
              {
                registryType: "npm",
                identifier: "with-args-mcp",
                runtimeArguments: [{ value: "-y" }],
                packageArguments: [{ value: "--root" }, { value: "/tmp" }],
              },
            ],
          },
        },
      ],
    });

    const [result] = await searchMcpRegistry("");

    expect(result.args).toEqual(["-y", "with-args-mcp", "--root", "/tmp"]);
  });

  it("uses runtimeHint as the command and does not force -y onto a non-npx runtime", async () => {
    stubRegistry({
      servers: [
        {
          server: {
            name: "example/bun",
            packages: [{ registryType: "npm", identifier: "bun-mcp", runtimeHint: "bunx" }],
          },
        },
      ],
    });

    const [result] = await searchMcpRegistry("");

    expect(result.command).toBe("bunx");
    expect(result.args).toEqual(["bun-mcp"]);
  });

  it("drops a package whose transport is not stdio, and keeps one that declares none", async () => {
    stubRegistry({
      servers: [
        {
          server: {
            name: "example/remote",
            packages: [{ registryType: "npm", identifier: "remote-mcp", transport: { type: "sse" } }],
          },
        },
        {
          server: {
            name: "example/implicit-stdio",
            packages: [{ registryType: "npm", identifier: "implicit-mcp" }],
          },
        },
      ],
    });

    const results = await searchMcpRegistry("");

    // MCPServerStdio is the only runtime here, so an sse package would install and then fail to
    // start. A missing transport is the registry's own stdio default.
    expect(results.map((r) => r.name)).toEqual(["example/implicit-stdio"]);
  });

  it("keys env by every declared variable but lists only the required ones", async () => {
    stubRegistry(REGISTRY_PAGE);

    const [result] = await searchMcpRegistry("filesystem");

    expect(result.env).toEqual({ GCS_BUCKET: "", GCS_PROJECT_ID: "" });
    expect(result.requiredEnv).toEqual(["GCS_BUCKET"]);
  });

  it("drops superseded versions but keeps an entry carrying no _meta", async () => {
    stubRegistry({
      servers: [
        {
          server: { name: "example/old", packages: [{ registryType: "npm", identifier: "old-mcp" }] },
          _meta: { "io.modelcontextprotocol.registry/official": { isLatest: false } },
        },
        {
          server: { name: "example/no-meta", packages: [{ registryType: "npm", identifier: "no-meta-mcp" }] },
        },
      ],
    });

    const results = await searchMcpRegistry("");

    // Guarded on `=== false` rather than `!== true` precisely so the second entry survives.
    expect(results.map((r) => r.name)).toEqual(["example/no-meta"]);
  });

  it("asks the registry for latest versions only, with the search term encoded", async () => {
    const fetchMock = stubRegistry({ servers: [] });

    await searchMcpRegistry("file system");

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("version=latest");
    expect(requestedUrl).toContain("search=file+system");
  });

  it("omits the search parameter entirely for an empty query", async () => {
    const fetchMock = stubRegistry({ servers: [] });

    await searchMcpRegistry("");

    const requestedUrl = fetchMock.mock.calls[0][0] as string;
    expect(requestedUrl).toContain("version=latest");
    expect(requestedUrl).not.toContain("search=");
  });

  it("aborts a slow registry rather than hanging the search", async () => {
    const fetchMock = stubRegistry({ servers: [] });

    await searchMcpRegistry("");

    // The endpoint was observed timing out on two of three consecutive requests (2026-08-02);
    // without a signal the Searching… state had no way back.
    expect((fetchMock.mock.calls[0][1] as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });

  it("throws with the status when the registry rejects the request", async () => {
    stubRegistry({}, { ok: false, status: 503, statusText: "Service Unavailable" });

    await expect(searchMcpRegistry("filesystem")).rejects.toThrow(
      "MCP registry search failed (503): Service Unavailable"
    );
  });
});
