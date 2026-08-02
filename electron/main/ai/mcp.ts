import { MCPServerStdio } from "@openai/agents";
import { getDb } from "../db";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { devLog } from "../devLog";
import { parseIdList, parseStringMap } from "../db/jsonColumn";
import { detachFromOrchestrator } from "../db/orchestratorAttachments";

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
  /** Defaults to enabled when omitted, which is what the manual Add form wants. Registry installs
   * pass `false` so a third-party command is never briefly live between two writes. */
  enabled?: boolean;
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
  /** Names of env vars the registry marks `isRequired`. Surfaced in the search results so an
   * install that will fail without a key says so up front, rather than at connect time. */
  requiredEnv: string[];
}

const MCP_REGISTRY_BASE_URL = "https://registry.modelcontextprotocol.io";
const MCP_REGISTRY_TIMEOUT_MS = 15_000;
const REGISTRY_OFFICIAL_META = "io.modelcontextprotocol.registry/official";

interface RegistryArgument {
  value?: string;
}

interface RegistryPackage {
  registryType?: string;
  identifier?: string;
  runtimeHint?: string;
  transport?: { type?: string };
  runtimeArguments?: RegistryArgument[];
  packageArguments?: RegistryArgument[];
  environmentVariables?: { name?: string; description?: string; isRequired?: boolean }[];
}

/** One element of the registry's `servers` array. The server's own fields sit nested under
 * `server`, not on this wrapper — reading them off the wrapper is what made every entry fail
 * the identifier/name check and silently return zero results for every query. */
interface RegistryEntry {
  server?: {
    name?: string;
    description?: string;
    packages?: RegistryPackage[];
  };
  _meta?: Record<string, { isLatest?: boolean } | undefined>;
}

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
  const stored = parseStringMap("mcp_servers.env", envJson);
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
  ).run(id, name, command, args, env, input.enabled === false ? 0 : 1);
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
  detachFromOrchestrator("mcp", id);
  // Detach from any agent that had it selected, so a deleted server never lingers as a
  // dangling id in an agent's mcp_server_ids and silently fails to connect on the next run.
  const agents = db.prepare("SELECT id, mcp_server_ids FROM agents").all() as { id: string; mcp_server_ids: string }[];
  for (const agent of agents) {
    const ids = parseIdList(`agents ${agent.id}/mcp_server_ids`, agent.mcp_server_ids);
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
    args: parseIdList(`mcp_servers ${row.id}/args`, row.args),
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
 * URL-based servers are out of scope for this pass.
 *
 * Verified against the live API (2026-08-02):
 * - Every element of `servers` is a `{ server, _meta }` wrapper; the name/description/packages
 *   live under `server`. Reading them off the wrapper returns **zero results for every query**,
 *   which is what this function did before.
 * - `?version=latest` is honoured server-side and is what keeps one server from filling the
 *   page: `search=filesystem` returns 30 rows without it — 14 of them the same server — and 10
 *   unique names with it, `nextCursor: null`.
 * - `runtimeHint` is absent on most npm entries, so `npx` stays the fallback.
 * - Non-npm packages (pypi/oci/nuget) are dropped: there is no runtime here that can start them.
 */
export async function searchMcpRegistry(query: string): Promise<McpSearchResult[]> {
  const params = new URLSearchParams({ version: "latest" });
  if (query) params.set("search", query);
  const response = await fetch(`${MCP_REGISTRY_BASE_URL}/v0/servers?${params.toString()}`, {
    signal: AbortSignal.timeout(MCP_REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`MCP registry search failed (${response.status}): ${response.statusText}`);
  }
  const data = (await response.json()) as { servers?: RegistryEntry[] };

  const results: McpSearchResult[] = [];
  for (const entry of data.servers ?? []) {
    const server = entry.server;
    if (!server?.name) continue;
    // Belt and braces for the `version=latest` param above: if the registry ever stops honouring
    // it, this still collapses the list to one row per server. Tested `=== false` rather than
    // `!== true` so an entry carrying no `_meta` at all is kept rather than silently dropped.
    if (entry._meta?.[REGISTRY_OFFICIAL_META]?.isLatest === false) continue;

    // A package can be npm-published and still speak a remote transport; `MCPServerStdio` is the
    // only runtime here, so anything that isn't stdio would be installed and then fail to start.
    // Missing `transport` is treated as stdio — that is the registry's own default.
    const npmPackage = server.packages?.find(
      (pkg) => pkg.registryType === "npm" && (pkg.transport?.type ?? "stdio") === "stdio"
    );
    if (!npmPackage?.identifier) continue;

    // runtimeArguments are the *runtime's* flags (npx's `-y`); packageArguments are the server's
    // own. They sit on opposite sides of the package identifier. Appending both after it, as this
    // did before, produced `npx -y remote-filesystem-mcp-server -y`.
    const runtimeArgs = (npmPackage.runtimeArguments ?? []).map((a) => a.value ?? "").filter(Boolean);
    const packageArgs = (npmPackage.packageArguments ?? []).map((a) => a.value ?? "").filter(Boolean);
    const command = npmPackage.runtimeHint ?? "npx";
    // Without `-y`, npx stops to prompt for install confirmation and the server never starts.
    // Only added when the registry didn't already supply it, so it can never appear twice.
    if (command === "npx" && !runtimeArgs.includes("-y")) runtimeArgs.unshift("-y");

    const env: Record<string, string> = {};
    const requiredEnv: string[] = [];
    for (const envVar of npmPackage.environmentVariables ?? []) {
      if (!envVar.name) continue;
      env[envVar.name] = "";
      if (envVar.isRequired) requiredEnv.push(envVar.name);
    }

    results.push({
      id: server.name,
      name: server.name,
      description: server.description ?? "",
      command,
      args: [...runtimeArgs, npmPackage.identifier, ...packageArgs],
      env,
      requiredEnv,
    });
  }
  return results;
}
