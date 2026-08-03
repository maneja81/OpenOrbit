import { tool, type Tool } from "@openai/agents";
import {
  getDecryptedCollectionHeaders,
  getDecryptedToolHeaders,
  isWriteMethod,
  listHttpToolCollections,
  listHttpTools,
  parseHttpToolParams,
  type HttpToolCollectionRow,
  type HttpToolParam,
  type HttpToolRow,
} from "../db/httpToolsStore";
import { safeFetch } from "../net/urlSafety";
import { buildHttpRequest, toolParamsSchema, type HttpToolArgValue } from "./httpToolRequest";
import { requiresApproval, type ApprovalPolicy } from "./approvalPolicy";
import { readAppSetting } from "../appSettings";
import { devLog } from "../devLog";

/** Per-request ceiling. A slow or hanging endpoint must never hold an agent run open until
 * the run-level timeout kills the whole turn. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Response bodies go straight into the model's context, so an unbounded one would blow the
 * context window (and the bill) on a single call. Truncation is marked so the model knows
 * it is looking at a partial body rather than treating it as the whole response. */
const MAX_RESPONSE_CHARS = 20_000;

export interface HttpToolResponse {
  status: number;
  statusText: string;
  ok: boolean;
  contentType: string | null;
  body: string;
  truncated: boolean;
}

/** Non-http(s) schemes are refused even when a collection opts into private hosts —
 * "allow private addresses" widens which *hosts* are reachable, never which protocols
 * (file:, data: etc. are not HTTP tools in any configuration). */
function assertHttpProtocol(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing to call a non-http(s) URL: "${url}"`);
  }
}

async function executeHttpTool(
  collection: HttpToolCollectionRow,
  row: HttpToolRow,
  params: HttpToolParam[],
  args: Record<string, HttpToolArgValue>
): Promise<HttpToolResponse> {
  const request = buildHttpRequest({
    baseUrl: collection.base_url,
    path: row.path,
    method: row.method,
    params,
    args,
    // Decrypted here, at the last possible moment before the call — never held in the
    // catalog the renderer sees. Same rule as connectorsStore.getDecryptedCredentials.
    collectionHeaders: getDecryptedCollectionHeaders(collection.id),
    toolHeaders: getDecryptedToolHeaders(row.id),
    bodyTemplate: row.body_template,
  });

  devLog(`[http-tool] ${row.tool_name} -> ${request.method} ${request.url}`);
  const fetchInit: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  };
  let response: Response;
  if (collection.allow_private_hosts) {
    assertHttpProtocol(request.url);
    response = await fetch(request.url, fetchInit);
  } else {
    // Also re-checks DNS-resolved addresses, so a public-looking hostname that resolves
    // into private space at request time is still refused (rebinding defense). safeFetch
    // re-validates every redirect hop too, so a 302 to private space is caught as well.
    response = await safeFetch(request.url, fetchInit);
  }

  const raw = await response.text();
  const truncated = raw.length > MAX_RESPONSE_CHARS;
  devLog(`[http-tool] ${row.tool_name} <- ${response.status} (${raw.length} chars)`);

  // A non-2xx is returned rather than thrown so the agent can report the real status and
  // body to the user. Throwing here would collapse "404 not found" and "the network is
  // down" into one indistinguishable tool failure.
  return {
    status: response.status,
    statusText: response.statusText,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    body: truncated ? `${raw.slice(0, MAX_RESPONSE_CHARS)}\n…[truncated]` : raw,
    truncated,
  };
}

/** The model-facing description. The endpoint's own description leads; the method and path
 * follow so the model can tell two similar endpoints apart, and a write is labelled as one.
 *
 * Deliberately says nothing about the confirmation gate. Stating it made the model ask the
 * user for permission in prose and never call the tool at all — so the SDK interruption
 * never fired and the turn stalled on a question the app was about to ask anyway (observed
 * live). Approval is a runtime concern, handled by needsApproval below; the model's job is
 * just to call the tool. */
function describeTool(collection: HttpToolCollectionRow, row: HttpToolRow): string {
  const parts = [row.description || `Calls ${row.method} ${row.path || "/"} on ${collection.name}.`];
  parts.push(`HTTP ${row.method} ${row.path || "/"} on ${collection.name} (${collection.base_url}).`);
  if (isWriteMethod(row.method)) {
    parts.push("This changes data on the remote service.");
  }
  return parts.join(" ");
}

/**
 * Reads the user's global approval posture, defaults resolved from settingsSchema so a database
 * that has never stored these keys still asks before every write.
 *
 * Through readAppSetting rather than getSetting, which matters more here than elsewhere: this
 * feeds `needsApproval` directly, and `getSetting<boolean>` is an assertion, not a check. A row
 * holding null — writable by any build from before the settings schema — is falsy, so the gate
 * would simply stop asking, silently and in the unsafe direction. Now a value that isn't a real
 * boolean falls back to "ask".
 */
export function readApprovalPolicy(): ApprovalPolicy {
  return {
    post: readAppSetting("httpToolApprovalPost"),
    putPatch: readAppSetting("httpToolApprovalPutPatch"),
    delete: readAppSetting("httpToolApprovalDelete"),
  };
}

function buildToolForRow(collection: HttpToolCollectionRow, row: HttpToolRow): Tool {
  const params = parseHttpToolParams(row);
  return tool({
    name: row.tool_name,
    description: describeTool(collection, row),
    parameters: toolParamsSchema(params),
    // SDK-native human-in-the-loop: the run stops with an interruption before this ever
    // executes, and only resumes once ipc/agent.ts approves it (see agent:approveTool).
    //
    // A function rather than a baked boolean so the policy is read when the call actually
    // happens. Agents are rebuilt per run today, but this way flipping a toggle mid-run
    // can never leave a stale decision attached to an already-built tool.
    needsApproval: async () => requiresApproval(row.method, readApprovalPolicy()),
    execute: async (args) => executeHttpTool(collection, row, params, args as Record<string, HttpToolArgValue>),
    // The SDK's default error handler replaces every failure with "An error occurred while
    // running the tool. Please try again." — which hides the actual cause (a refused
    // private address, a missing parameter, a DNS failure) and invites the model to retry
    // a call that can never succeed. These messages are written to be shown to the user, so
    // they're surfaced verbatim instead.
    errorFunction: (_context, error) =>
      `${row.tool_name} failed: ${error instanceof Error ? error.message : String(error)}`,
  });
}

/** Builds the real tool() objects for a list of collection ids, mirroring
 * attachConnectorsForIds in ai/agents.ts. A collection that is missing or disabled — and
 * any individual endpoint that is disabled — is skipped rather than failing the whole agent
 * build, the same "one bad attachment must never take down the run" rule that
 * connectMcpServersForAgent and attachConnectorsForIds already follow. */
export function buildHttpToolsForCollectionIds(collectionIds: string[]): Tool[] {
  if (collectionIds.length === 0) return [];
  const collections = new Map(listHttpToolCollections().map((row) => [row.id, row]));

  const tools: Tool[] = [];
  for (const collectionId of collectionIds) {
    const collection = collections.get(collectionId);
    if (!collection || collection.enabled !== 1) continue;
    for (const row of listHttpTools(collection.id)) {
      if (row.enabled !== 1) continue;
      try {
        tools.push(buildToolForRow(collection, row));
      } catch (error) {
        devLog(
          `[http-tool] failed to build "${row.tool_name}" (${row.id}): ${error instanceof Error ? error.message : error}`
        );
      }
    }
  }
  return tools;
}

/** One collection plus its endpoints, as the prompt formatter needs them. Kept as a plain
 * shape (rather than reading the DB) so formatHttpToolsForPrompt stays pure and testable. */
export interface HttpToolPromptCollection {
  name: string;
  description: string;
  baseUrl: string;
  tools: {
    toolName: string;
    method: string;
    path: string;
    description: string;
    params: HttpToolParam[];
    /** The decision the global policy actually resolves to for this endpoint's method —
     * not a stored property. Passed in so the prompt can never advertise a gate the user
     * has switched off. */
    willAskApproval: boolean;
  }[];
}

function formatParam(param: HttpToolParam): string {
  return `${param.name} (${param.type}, ${param.required ? "required" : "optional"})`;
}

/**
 * Renders the block appended to an agent's instructions when HTTP tools are attached.
 *
 * Attached tools otherwise reach the model only as tool descriptions; this states plainly
 * that the agent has them, which API they belong to, and what each one needs — the same
 * "tell the agent what it has" role agentDataContext plays for the per-agent data store in
 * ai/agents.ts. Returns "" when nothing is attached, so a prompt gains no stray whitespace.
 */
export function formatHttpToolsForPrompt(collections: HttpToolPromptCollection[]): string {
  const withTools = collections.filter((collection) => collection.tools.length > 0);
  if (withTools.length === 0) return "";

  const lines: string[] = [];
  lines.push(
    `\n\nYou have HTTP tools attached from ${withTools.length} API ${
      withTools.length === 1 ? "collection" : "collections"
    }:`
  );

  for (const collection of withTools) {
    const suffix = collection.description ? ` — ${collection.description}` : "";
    lines.push(`\n${collection.name} (${collection.baseUrl})${suffix}`);
    for (const entry of collection.tools) {
      const detail: string[] = [];
      if (entry.description) detail.push(entry.description);
      if (entry.params.length > 0) {
        detail.push(`Parameters: ${entry.params.map(formatParam).join(", ")}.`);
      }
      if (entry.willAskApproval) {
        // Phrased as "the app already handles this" rather than "confirmation is
        // required" — the latter reads as an instruction to ask first, which made the
        // model reply with a question instead of calling the tool (observed live). The
        // approval prompt is raised by the runtime, after the call is requested.
        detail.push("The app automatically asks the user to approve this one — call it directly, don't ask first.");
      }
      const suffixText = detail.length > 0 ? `: ${detail.join(" ")}` : "";
      lines.push(`  - ${entry.toolName} (${entry.method} ${entry.path || "/"})${suffixText}`);
    }
  }

  lines.push(
    "\nCall these tools directly when a request matches what they do — never ask the user for permission in chat " +
      "first, the app raises its own approval prompt where one is needed. Report the real HTTP status and the data " +
      "actually returned — never invent a response or claim a call succeeded when it did not."
  );
  return lines.join("\n");
}

/** Reads the rows for a set of attached collection ids and renders the prompt block for
 * them. The DB-touching half of formatHttpToolsForPrompt, kept separate so the formatting
 * itself stays pure. */
export function buildHttpToolsPromptBlock(collectionIds: string[]): string {
  if (collectionIds.length === 0) return "";
  const collections = new Map(listHttpToolCollections().map((row) => [row.id, row]));
  const policy = readApprovalPolicy();

  const promptCollections: HttpToolPromptCollection[] = [];
  for (const collectionId of collectionIds) {
    const collection = collections.get(collectionId);
    if (!collection || collection.enabled !== 1) continue;
    promptCollections.push({
      name: collection.name,
      description: collection.description,
      baseUrl: collection.base_url,
      tools: listHttpTools(collection.id)
        .filter((row) => row.enabled === 1)
        .map((row) => ({
          toolName: row.tool_name,
          method: row.method,
          path: row.path,
          description: row.description,
          params: parseHttpToolParams(row),
          willAskApproval: requiresApproval(row.method, policy),
        })),
    });
  }
  return formatHttpToolsForPrompt(promptCollections);
}
