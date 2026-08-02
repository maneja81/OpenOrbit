import { MCPServerStdio } from "@openai/agents";
import { getDb } from "../db";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { devLog } from "../devLog";

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args: string; // JSON-stringified string[]
  env: string; // JSON-stringified Record<string, string> (values encrypted at rest)
  enabled: number;
  created_at: string;
}

export interface McpServerInput {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpServerUpdatePatch {
  name?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpSearchResult {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

const MCP_REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mcp-server";
}

function uniqueServerId(db: ReturnType<typeof getDb>, base: string): string {
  let candidate = base;
  let suffix = 2;
  while (db.prepare("SELECT id FROM mcp_servers WHERE id = ?").get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function encryptEnv(env: Record<string, string>): string {
  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    encrypted[key] = encryptSecret(value);
  }
  return JSON.stringify(encrypted);
}

function decryptEnv(envJson: string): Record<string, string> {
  const stored = JSON.parse(envJson) as Record<string, string>;
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    decrypted[key] = decryptSecret(value);
  }
  return decrypted;
}

export function listMcpServers(): McpServerRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM mcp_servers ORDER BY created_at ASC").all() as McpServerRow[];
}

// mcp:list intentionally leaves env encrypted (never sent decrypted in bulk) — this is a
// separate, explicit fetch used only when a user opens a single server for editing, same
// precedent as settings:get decrypting the AI provider API key for its edit-in-place field.
export function getDecryptedEnv(id: string): Record<string, string> {
  const db = getDb();
  const row = db.prepare("SELECT env FROM mcp_servers WHERE id = ?").get(id) as { env: string } | undefined;
  if (!row) throw new Error(`Unknown MCP server: ${id}`);
  return decryptEnv(row.env);
}

export function createMcpServer(input: McpServerInput): McpServerRow {
  const db = getDb();
  const name = input.name.trim();
  if (!name) {
    throw new Error("MCP server name is required.");
  }
  const command = input.command.trim();
  if (!command) {
    throw new Error("MCP server command is required.");
  }
  const id = uniqueServerId(db, slugify(name));
  const args = JSON.stringify(input.args ?? []);
  const env = encryptEnv(input.env ?? {});
  db.prepare(
    "INSERT INTO mcp_servers (id, name, command, args, env, enabled) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(id, name, command, args, env, 1);
  return db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow;
}

export function updateMcpServer(id: string, patch: McpServerUpdatePatch): McpServerRow {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow | undefined;
  if (!existing) {
    throw new Error(`Unknown MCP server: ${id}`);
  }
  const next = {
    name: patch.name?.trim() || existing.name,
    command: patch.command?.trim() || existing.command,
    args: patch.args === undefined ? existing.args : JSON.stringify(patch.args),
    env: patch.env === undefined ? existing.env : encryptEnv(patch.env),
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
  };
  db.prepare(
    "UPDATE mcp_servers SET name = ?, command = ?, args = ?, env = ?, enabled = ? WHERE id = ?"
  ).run(next.name, next.command, next.args, next.env, next.enabled, id);
  return db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow;
}

export function deleteMcpServer(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM mcp_servers WHERE id = ?").run(id);
  // Detach from any agent that had it selected, so a deleted server never lingers as a
  // dangling id in an agent's mcp_server_ids and silently fails to connect on the next run.
  const agents = db.prepare("SELECT id, mcp_server_ids FROM agents").all() as { id: string; mcp_server_ids: string }[];
  for (const agent of agents) {
    const ids = JSON.parse(agent.mcp_server_ids) as string[];
    if (!ids.includes(id)) continue;
    db.prepare("UPDATE agents SET mcp_server_ids = ? WHERE id = ?").run(
      JSON.stringify(ids.filter((existingId) => existingId !== id)),
      agent.id
    );
  }
}

function buildStdioServer(row: McpServerRow): MCPServerStdio {
  return new MCPServerStdio({
    name: row.name,
    command: row.command,
    args: JSON.parse(row.args) as string[],
    env: decryptEnv(row.env),
  });
}

/** Connects every enabled server in `serverIds` (attached to one agent). A server that
 * fails to start is logged and skipped rather than failing the whole agent run — one bad
 * MCP server must never take down the chat response. */
export async function connectMcpServersForAgent(serverIds: string[]): Promise<MCPServerStdio[]> {
  if (serverIds.length === 0) return [];
  const db = getDb();
  const rows = serverIds
    .map((id) => db.prepare("SELECT * FROM mcp_servers WHERE id = ?").get(id) as McpServerRow | undefined)
    .filter((row): row is McpServerRow => Boolean(row) && row!.enabled === 1);

  const connected: MCPServerStdio[] = [];
  for (const row of rows) {
    try {
      const server = buildStdioServer(row);
      await server.connect();
      connected.push(server);
    } catch (error) {
      devLog(`[mcp] failed to connect server "${row.name}" (${row.id}): ${error instanceof Error ? error.message : error}`);
    }
  }
  return connected;
}

export async function closeMcpServers(servers: MCPServerStdio[]): Promise<void> {
  await Promise.allSettled(servers.map((server) => server.close()));
}

/** One-off connect + list tools + close, used by the "Test connection" UI before a user
 * commits to enabling a server. Never persists anything. */
export async function testMcpServer(input: McpServerInput): Promise<{ tools: string[] }> {
  const server = new MCPServerStdio({
    name: input.name || "test-server",
    command: input.command,
    args: input.args ?? [],
    env: input.env ?? {},
  });
  try {
    await server.connect();
    const tools = await server.listTools();
    return { tools: tools.map((tool) => tool.name) };
  } finally {
    await server.close().catch(() => {});
  }
}

/** Proxies the official MCP Registry (registry.modelcontextprotocol.io) server-side —
 * avoids a renderer-side fetch (CORS) and keeps the registry's response shape isolated
 * to this one place. Returns only stdio-installable candidates (command-based); remote/
 * URL-based servers are out of scope for this pass. */
export async function searchMcpRegistry(query: string): Promise<McpSearchResult[]> {
  const url = `${MCP_REGISTRY_BASE_URL}/v0/servers${query ? `?search=${encodeURIComponent(query)}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MCP registry search failed (${response.status}): ${response.statusText}`);
  }
  const data = (await response.json()) as {
    servers?: {
      name?: string;
      description?: string;
      packages?: { registryType?: string; identifier?: string; runtimeArguments?: { value?: string }[]; environmentVariables?: { name?: string; description?: string }[] }[];
    }[];
  };

  const results: McpSearchResult[] = [];
  for (const entry of data.servers ?? []) {
    const npmPackage = entry.packages?.find((pkg) => pkg.registryType === "npm");
    if (!npmPackage?.identifier || !entry.name) continue;
    const env: Record<string, string> = {};
    for (const envVar of npmPackage.environmentVariables ?? []) {
      if (envVar.name) env[envVar.name] = "";
    }
    results.push({
      id: entry.name,
      name: entry.name,
      description: entry.description ?? "",
      command: "npx",
      args: ["-y", npmPackage.identifier, ...(npmPackage.runtimeArguments ?? []).map((a) => a.value ?? "").filter(Boolean)],
      env,
    });
  }
  return results;
}
