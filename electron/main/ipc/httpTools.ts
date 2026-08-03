import { ipcMain } from "electron";
import {
  createHttpTool,
  createHttpToolCollection,
  deleteHttpTool,
  deleteHttpToolCollection,
  getDecryptedCollectionHeaders,
  getDecryptedToolHeaders,
  listHttpToolCollections,
  listHttpTools,
  updateHttpTool,
  updateHttpToolCollection,
  HTTP_METHODS,
  type HttpToolCollectionInput,
  type HttpToolCollectionPatch,
  type HttpToolInput,
  type HttpToolParam,
  type HttpToolPatch,
} from "../db/httpToolsStore";
import { buildHttpRequest } from "../ai/httpToolRequest";
import { safeFetch } from "../net/urlSafety";

export type { HttpToolCollectionRow, HttpToolRow, HttpToolParam } from "../db/httpToolsStore";

const PARAM_TYPES = ["string", "number", "boolean"];
const PARAM_LOCATIONS = ["path", "query", "header", "body"];
// Matches the capture class httpToolRequest.ts's own PLACEHOLDER_PATTERN uses for
// {{name}} — a param name is later interpolated unescaped into a per-param RegExp when
// substituting path placeholders, so anything outside this class (e.g. ".*", or an
// unbalanced "(") either swallows every placeholder in the path or throws a SyntaxError
// building the regex. Enforcing the same class the placeholder syntax already implies
// closes that off at the one place params are created or edited.
const PARAM_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertPlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
}

function assertNonEmptyString(value: unknown, message: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
}

// headers is JSON.stringify'd straight into the DB after per-value encryption — a
// malformed shape here would only surface much later as a decrypt failure at call time,
// exactly the reasoning behind ipc/mcp.ts's assertArgsAndEnvShape.
function assertHeadersShape(value: unknown, prefix: string): asserts value is Record<string, string> {
  assertPlainObject(value, `${prefix} headers must be an object of string values`);
  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      throw new Error(`${prefix} headers must be an object of string values`);
    }
    // Rejected at the boundary as well as at request-build time: a stored header carrying
    // a newline would be a persisted request-splitting payload waiting to be used.
    if (/[\r\n]/.test(key) || /[\r\n]/.test(headerValue)) {
      throw new Error(`${prefix} header "${key}" cannot contain line breaks`);
    }
  }
}

function assertMethod(value: unknown, prefix: string): asserts value is string {
  assertNonEmptyString(value, `${prefix} method must be a non-empty string`);
  if (!(HTTP_METHODS as readonly string[]).includes(value.toUpperCase())) {
    throw new Error(`${prefix} method must be one of ${HTTP_METHODS.join(", ")}`);
  }
}

function assertParamsShape(value: unknown, prefix: string): asserts value is HttpToolParam[] {
  if (!Array.isArray(value)) {
    throw new Error(`${prefix} params must be an array`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    assertPlainObject(entry, `${prefix} each param must be an object`);
    assertNonEmptyString(entry.name, `${prefix} each param needs a non-empty name`);
    if (!PARAM_NAME_PATTERN.test(entry.name)) {
      throw new Error(
        `${prefix} param name "${entry.name}" must match ${PARAM_NAME_PATTERN} (letters, digits, underscore; not starting with a digit)`
      );
    }
    // The name becomes a key in the generated zod schema, so a duplicate would silently
    // overwrite the earlier one and drop a parameter the user thinks they declared.
    if (seen.has(entry.name)) {
      throw new Error(`${prefix} duplicate param name "${entry.name}"`);
    }
    seen.add(entry.name);
    if (typeof entry.description !== "string") {
      throw new Error(`${prefix} param "${entry.name}" description must be a string`);
    }
    if (typeof entry.type !== "string" || !PARAM_TYPES.includes(entry.type)) {
      throw new Error(`${prefix} param "${entry.name}" type must be one of ${PARAM_TYPES.join(", ")}`);
    }
    if (typeof entry.location !== "string" || !PARAM_LOCATIONS.includes(entry.location)) {
      throw new Error(`${prefix} param "${entry.name}" location must be one of ${PARAM_LOCATIONS.join(", ")}`);
    }
    if (typeof entry.required !== "boolean") {
      throw new Error(`${prefix} param "${entry.name}" required must be a boolean`);
    }
  }
}

// A misspelled key is otherwise indistinguishable from an omitted one, and the omission is
// what gets reported: passing `values` instead of `args` surfaced as `Missing required
// parameter "id"`, which reads as a bad param definition rather than a wrong key name.
// Naming the accepted set puts the real key in front of the caller.
function assertNoUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], prefix: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(
      `${prefix} does not accept ${unknown.map((key) => `"${key}"`).join(", ")} — accepted keys are ${allowed.join(", ")}`
    );
  }
}

const TEST_TOOL_KEYS = [
  "baseUrl",
  "path",
  "method",
  "params",
  "args",
  "headers",
  "bodyTemplate",
  "allowPrivateHosts",
] as const;

export function registerHttpToolHandlers() {
  ipcMain.handle("httpTools:listCollections", () => listHttpToolCollections());

  ipcMain.handle("httpTools:listTools", (_event, collectionId?: string) => {
    if (collectionId !== undefined && typeof collectionId !== "string") {
      throw new Error("httpTools:listTools collectionId must be a string when provided");
    }
    return listHttpTools(collectionId);
  });

  ipcMain.handle("httpTools:createCollection", (_event, input: HttpToolCollectionInput) => {
    assertPlainObject(input, "httpTools:createCollection requires a plain object input");
    assertNonEmptyString(input.name, "httpTools:createCollection requires a non-empty name");
    assertNonEmptyString(input.baseUrl, "httpTools:createCollection requires a non-empty baseUrl");
    if (input.headers !== undefined) assertHeadersShape(input.headers, "httpTools:createCollection");
    return createHttpToolCollection(input);
  });

  ipcMain.handle("httpTools:updateCollection", (_event, id: string, patch: HttpToolCollectionPatch) => {
    assertNonEmptyString(id, "httpTools:updateCollection requires a non-empty collection id");
    assertPlainObject(patch, "httpTools:updateCollection requires a plain object patch");
    if (patch.headers !== undefined) assertHeadersShape(patch.headers, "httpTools:updateCollection");
    return updateHttpToolCollection(id, patch);
  });

  ipcMain.handle("httpTools:deleteCollection", (_event, id: string) => {
    assertNonEmptyString(id, "httpTools:deleteCollection requires a non-empty collection id");
    deleteHttpToolCollection(id);
  });

  ipcMain.handle("httpTools:createTool", (_event, input: HttpToolInput) => {
    assertPlainObject(input, "httpTools:createTool requires a plain object input");
    assertNonEmptyString(input.collectionId, "httpTools:createTool requires a non-empty collectionId");
    assertNonEmptyString(input.name, "httpTools:createTool requires a non-empty name");
    if (input.method !== undefined) assertMethod(input.method, "httpTools:createTool");
    if (input.headers !== undefined) assertHeadersShape(input.headers, "httpTools:createTool");
    if (input.params !== undefined) assertParamsShape(input.params, "httpTools:createTool");
    return createHttpTool(input);
  });

  ipcMain.handle("httpTools:updateTool", (_event, id: string, patch: HttpToolPatch) => {
    assertNonEmptyString(id, "httpTools:updateTool requires a non-empty tool id");
    assertPlainObject(patch, "httpTools:updateTool requires a plain object patch");
    if (patch.method !== undefined) assertMethod(patch.method, "httpTools:updateTool");
    if (patch.headers !== undefined) assertHeadersShape(patch.headers, "httpTools:updateTool");
    if (patch.params !== undefined) assertParamsShape(patch.params, "httpTools:updateTool");
    return updateHttpTool(id, patch);
  });

  ipcMain.handle("httpTools:deleteTool", (_event, id: string) => {
    assertNonEmptyString(id, "httpTools:deleteTool requires a non-empty tool id");
    deleteHttpTool(id);
  });

  // Explicit, single-row decryption for the edit form — the list handlers above never
  // decrypt. Same precedent as mcp:getEnv and connectors:getSettings.
  ipcMain.handle("httpTools:getCollectionHeaders", (_event, id: string) => {
    assertNonEmptyString(id, "httpTools:getCollectionHeaders requires a non-empty collection id");
    return getDecryptedCollectionHeaders(id);
  });

  ipcMain.handle("httpTools:getToolHeaders", (_event, id: string) => {
    assertNonEmptyString(id, "httpTools:getToolHeaders requires a non-empty tool id");
    return getDecryptedToolHeaders(id);
  });

  /** One-off "does this endpoint actually work" check from the editing UI, before the user
   * commits to attaching it to an agent. Mirrors mcp:test — it persists nothing, and it
   * takes the draft values from the form rather than reading a saved row, so an unsaved
   * edit can be tried out. Sample argument values come from the caller.
   *
   * The confirmation gate is deliberately NOT applied here: this is the user pressing a
   * button themselves, which is already the consent that gate exists to collect. */
  ipcMain.handle(
    "httpTools:testTool",
    async (
      _event,
      input: {
        baseUrl: string;
        path?: string;
        method?: string;
        params?: HttpToolParam[];
        args?: Record<string, string | number | boolean | null>;
        headers?: Record<string, string>;
        bodyTemplate?: string;
        allowPrivateHosts?: boolean;
      }
    ): Promise<{ ok: boolean; status?: number; statusText?: string; body?: string; error?: string }> => {
      assertPlainObject(input, "httpTools:testTool requires a plain object input");
      assertNoUnknownKeys(input, TEST_TOOL_KEYS, "httpTools:testTool");
      assertNonEmptyString(input.baseUrl, "httpTools:testTool requires a non-empty baseUrl");
      if (input.method !== undefined) assertMethod(input.method, "httpTools:testTool");
      if (input.headers !== undefined) assertHeadersShape(input.headers, "httpTools:testTool");
      if (input.params !== undefined) assertParamsShape(input.params, "httpTools:testTool");
      if (input.args !== undefined) assertPlainObject(input.args, "httpTools:testTool args must be an object");

      try {
        const request = buildHttpRequest({
          baseUrl: input.baseUrl,
          path: input.path ?? "",
          method: input.method ?? "GET",
          params: input.params ?? [],
          args: input.args ?? {},
          collectionHeaders: input.headers,
          bodyTemplate: input.bodyTemplate,
        });
        const fetchInit: RequestInit = {
          method: request.method,
          headers: request.headers,
          body: request.body,
          signal: AbortSignal.timeout(15_000),
        };
        // safeFetch re-validates every redirect hop, so a 302 to private space is caught
        // even though the initial URL passed assertPublicHttpUrl.
        const response = input.allowPrivateHosts
          ? await fetch(request.url, fetchInit)
          : await safeFetch(request.url, fetchInit);
        const body = await response.text();
        return {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          body: body.length > 2000 ? `${body.slice(0, 2000)}\n…[truncated]` : body,
        };
      } catch (error) {
        // Returned rather than thrown so the form can show the reason inline, matching
        // connectors:test's { ok, error } shape.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
