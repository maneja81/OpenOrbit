import { getDb } from "./index";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { parseIdList, parseStringMap } from "./jsonColumn";

/** One user-declared input to an HTTP tool. `location` decides where the value ends up in
 * the outgoing request — see ai/httpToolRequest.ts, which is the only place that reads it. */
export interface HttpToolParam {
  name: string;
  description: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  location: "path" | "query" | "header" | "body";
}

export interface HttpToolCollectionRow {
  id: string;
  name: string;
  description: string;
  base_url: string;
  /** JSON-stringified Record<string, string>; values encrypted at rest. */
  headers: string;
  enabled: number;
  allow_private_hosts: number;
  created_at: string;
}

export interface HttpToolRow {
  id: string;
  collection_id: string;
  name: string;
  tool_name: string;
  description: string;
  method: string;
  path: string;
  /** JSON-stringified Record<string, string>; values encrypted at rest. */
  headers: string;
  body_template: string;
  /** JSON-stringified HttpToolParam[]. */
  params: string;
  enabled: number;
  created_at: string;
}

export interface HttpToolCollectionInput {
  name: string;
  description?: string;
  baseUrl: string;
  headers?: Record<string, string>;
  allowPrivateHosts?: boolean;
}

export interface HttpToolCollectionPatch {
  name?: string;
  description?: string;
  baseUrl?: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  allowPrivateHosts?: boolean;
}

export interface HttpToolInput {
  collectionId: string;
  name: string;
  description?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  params?: HttpToolParam[];
}

export interface HttpToolPatch {
  name?: string;
  description?: string;
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  bodyTemplate?: string;
  params?: HttpToolParam[];
  enabled?: boolean;
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Methods that change state on the far end — used to label a row in the UI. Whether one
 * actually pauses for approval is decided by the global policy in ai/approvalPolicy.ts. */
export const WRITE_METHODS: readonly string[] = ["POST", "PUT", "PATCH", "DELETE"];

export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.includes(method.toUpperCase());
}

function slugify(name: string, fallback: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

/** Tool ids are what the model calls, so they follow the same snake_case shape as every
 * hand-written tool in ai/tools/ (`save_user_info`, `web_search`) rather than the
 * hyphenated form used for row ids. */
function toToolName(name: string): string {
  return slugify(name, "http-tool").replace(/-/g, "_");
}

function uniqueId(table: "http_tool_collections" | "http_tools", base: string): string {
  const db = getDb();
  let candidate = base;
  let suffix = 2;
  while (db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** tool_name carries a UNIQUE constraint (migration 33) because the SDK resolves tools by
 * name alone within one agent — two endpoints named "get_post" would silently shadow each
 * other. Suffixing keeps that a non-event for the user instead of a save failure. */
function uniqueToolName(base: string, excludeId?: string): string {
  const db = getDb();
  let candidate = base;
  let suffix = 2;
  for (;;) {
    const existing = db.prepare("SELECT id FROM http_tools WHERE tool_name = ?").get(candidate) as
      | { id: string }
      | undefined;
    if (!existing || existing.id === excludeId) return candidate;
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
}

function encryptHeaders(headers: Record<string, string>): string {
  const encrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    encrypted[key] = encryptSecret(value);
  }
  return JSON.stringify(encrypted);
}

function decryptHeaders(headersJson: string): Record<string, string> {
  const stored = parseStringMap("http_tools.headers", headersJson);
  const decrypted: Record<string, string> = {};
  for (const [key, value] of Object.entries(stored)) {
    decrypted[key] = decryptSecret(value);
  }
  return decrypted;
}

export function listHttpToolCollections(): HttpToolCollectionRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM http_tool_collections ORDER BY created_at ASC")
    .all() as HttpToolCollectionRow[];
}

export function listHttpTools(collectionId?: string): HttpToolRow[] {
  const db = getDb();
  if (collectionId === undefined) {
    return db.prepare("SELECT * FROM http_tools ORDER BY created_at ASC").all() as HttpToolRow[];
  }
  return db
    .prepare("SELECT * FROM http_tools WHERE collection_id = ? ORDER BY created_at ASC")
    .all(collectionId) as HttpToolRow[];
}

// Bulk listing intentionally leaves headers encrypted — same rule as mcp.ts's getDecryptedEnv
// and connectorsStore's getDecryptedCredentials: decrypt on demand, only when a user opens
// one row to edit it or a tool is about to make a real call.
export function getDecryptedCollectionHeaders(id: string): Record<string, string> {
  const db = getDb();
  const row = db.prepare("SELECT headers FROM http_tool_collections WHERE id = ?").get(id) as
    | { headers: string }
    | undefined;
  if (!row) throw new Error(`Unknown HTTP tool collection: ${id}`);
  return decryptHeaders(row.headers);
}

export function getDecryptedToolHeaders(id: string): Record<string, string> {
  const db = getDb();
  const row = db.prepare("SELECT headers FROM http_tools WHERE id = ?").get(id) as { headers: string } | undefined;
  if (!row) throw new Error(`Unknown HTTP tool: ${id}`);
  return decryptHeaders(row.headers);
}

export function createHttpToolCollection(input: HttpToolCollectionInput): HttpToolCollectionRow {
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Collection name is required.");
  const baseUrl = input.baseUrl.trim();
  if (!baseUrl) throw new Error("Base URL is required.");

  const id = uniqueId("http_tool_collections", slugify(name, "http-collection"));
  db.prepare(
    `INSERT INTO http_tool_collections (id, name, description, base_url, headers, enabled, allow_private_hosts)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    name,
    input.description?.trim() ?? "",
    baseUrl,
    encryptHeaders(input.headers ?? {}),
    1,
    input.allowPrivateHosts ? 1 : 0
  );
  return db.prepare("SELECT * FROM http_tool_collections WHERE id = ?").get(id) as HttpToolCollectionRow;
}

export function updateHttpToolCollection(id: string, patch: HttpToolCollectionPatch): HttpToolCollectionRow {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM http_tool_collections WHERE id = ?").get(id) as
    | HttpToolCollectionRow
    | undefined;
  if (!existing) throw new Error(`Unknown HTTP tool collection: ${id}`);

  // An explicitly-supplied but blank name/base URL is rejected rather than silently kept,
  // matching updateAgent's handling — otherwise a caller could report success while the
  // value never actually changed.
  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new Error("Collection name cannot be blank.");
  }
  if (patch.baseUrl !== undefined && patch.baseUrl.trim().length === 0) {
    throw new Error("Base URL cannot be blank.");
  }

  const next = {
    name: patch.name === undefined ? existing.name : patch.name.trim(),
    description: patch.description === undefined ? existing.description : patch.description.trim(),
    base_url: patch.baseUrl === undefined ? existing.base_url : patch.baseUrl.trim(),
    headers: patch.headers === undefined ? existing.headers : encryptHeaders(patch.headers),
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
    allow_private_hosts:
      patch.allowPrivateHosts === undefined ? existing.allow_private_hosts : patch.allowPrivateHosts ? 1 : 0,
  };
  db.prepare(
    `UPDATE http_tool_collections
     SET name = ?, description = ?, base_url = ?, headers = ?, enabled = ?, allow_private_hosts = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.description,
    next.base_url,
    next.headers,
    next.enabled,
    next.allow_private_hosts,
    id
  );
  return db.prepare("SELECT * FROM http_tool_collections WHERE id = ?").get(id) as HttpToolCollectionRow;
}

/** Deletes a collection and (via the migration's ON DELETE CASCADE) every endpoint under
 * it, then detaches it from any agent that had it selected — so a deleted collection never
 * lingers as a dangling id that silently fails to attach on the next run. Same sweep as
 * mcp.ts's deleteMcpServer and connectorsStore's disconnectConnector. */
export function deleteHttpToolCollection(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM http_tool_collections WHERE id = ?").run(id);

  const agents = db.prepare("SELECT id, http_tool_collection_ids FROM agents").all() as {
    id: string;
    http_tool_collection_ids: string;
  }[];
  for (const agent of agents) {
    const ids = parseIdList(`agents ${agent.id}/http_tool_collection_ids`, agent.http_tool_collection_ids);
    if (!ids.includes(id)) continue;
    db.prepare("UPDATE agents SET http_tool_collection_ids = ? WHERE id = ?").run(
      JSON.stringify(ids.filter((existingId) => existingId !== id)),
      agent.id
    );
  }
}

export function createHttpTool(input: HttpToolInput): HttpToolRow {
  const db = getDb();
  const collection = db.prepare("SELECT id FROM http_tool_collections WHERE id = ?").get(input.collectionId);
  if (!collection) throw new Error(`Unknown HTTP tool collection: ${input.collectionId}`);

  const name = input.name.trim();
  if (!name) throw new Error("Tool name is required.");

  const id = uniqueId("http_tools", slugify(name, "http-tool"));
  const toolName = uniqueToolName(toToolName(name));
  db.prepare(
    `INSERT INTO http_tools
       (id, collection_id, name, tool_name, description, method, path, headers, body_template, params, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.collectionId,
    name,
    toolName,
    input.description?.trim() ?? "",
    (input.method ?? "GET").toUpperCase(),
    input.path?.trim() ?? "",
    encryptHeaders(input.headers ?? {}),
    input.bodyTemplate ?? "",
    JSON.stringify(input.params ?? []),
    1
  );
  return db.prepare("SELECT * FROM http_tools WHERE id = ?").get(id) as HttpToolRow;
}

export function updateHttpTool(id: string, patch: HttpToolPatch): HttpToolRow {
  const db = getDb();
  const existing = db.prepare("SELECT * FROM http_tools WHERE id = ?").get(id) as HttpToolRow | undefined;
  if (!existing) throw new Error(`Unknown HTTP tool: ${id}`);

  if (patch.name !== undefined && patch.name.trim().length === 0) {
    throw new Error("Tool name cannot be blank.");
  }

  const nextName = patch.name === undefined ? existing.name : patch.name.trim();
  // The model-facing tool_name follows a rename, so a tool renamed "Get Post" → "Fetch Post"
  // stops being called by its old id. excludeId keeps the row's own current name from
  // colliding with itself and gaining a pointless "_2" on every unrelated save.
  const nextToolName =
    patch.name === undefined ? existing.tool_name : uniqueToolName(toToolName(nextName), id);

  const next = {
    name: nextName,
    tool_name: nextToolName,
    description: patch.description === undefined ? existing.description : patch.description.trim(),
    method: patch.method === undefined ? existing.method : patch.method.toUpperCase(),
    path: patch.path === undefined ? existing.path : patch.path.trim(),
    headers: patch.headers === undefined ? existing.headers : encryptHeaders(patch.headers),
    body_template: patch.bodyTemplate === undefined ? existing.body_template : patch.bodyTemplate,
    params: patch.params === undefined ? existing.params : JSON.stringify(patch.params),
    enabled: patch.enabled === undefined ? existing.enabled : patch.enabled ? 1 : 0,
  };
  db.prepare(
    `UPDATE http_tools
     SET name = ?, tool_name = ?, description = ?, method = ?, path = ?, headers = ?, body_template = ?,
         params = ?, enabled = ?
     WHERE id = ?`
  ).run(
    next.name,
    next.tool_name,
    next.description,
    next.method,
    next.path,
    next.headers,
    next.body_template,
    next.params,
    next.enabled,
    id
  );
  return db.prepare("SELECT * FROM http_tools WHERE id = ?").get(id) as HttpToolRow;
}

export function deleteHttpTool(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM http_tools WHERE id = ?").run(id);
}

/** Never throws on a malformed stored value — a hand-edited or partially-written params
 * column must degrade to "no parameters" rather than taking down every agent build that
 * touches this collection. Same defensive shape as agents.ts's parseConnectorIds. */
export function parseHttpToolParams(row: Pick<HttpToolRow, "params">): HttpToolParam[] {
  try {
    const parsed = JSON.parse(row.params) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is HttpToolParam => {
      if (typeof p !== "object" || p === null) return false;
      const candidate = p as Partial<HttpToolParam>;
      return typeof candidate.name === "string" && candidate.name.length > 0;
    });
  } catch {
    return [];
  }
}
