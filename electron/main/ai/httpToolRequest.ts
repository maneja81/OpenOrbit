import { z } from "zod";
import type { HttpToolParam } from "../db/httpToolsStore";

/** A fully-resolved outgoing request. Pure data — nothing here performs I/O, so the whole
 * substitution/encoding surface is unit-testable without a network or a database. */
export interface BuiltHttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** Serialized JSON body, or undefined when the request carries no body. */
  body?: string;
}

/** Values the model is allowed to supply for a parameter. `null` is how an optional
 * parameter says "not provided" — see toolParamsSchema for why optional is modelled as
 * nullable rather than optional. */
export type HttpToolArgValue = string | number | boolean | null;

const PLACEHOLDER_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Builds the zod schema the SDK converts into the model-facing tool signature.
 *
 * Optional parameters are `.nullable()` rather than `.optional()` — the SDK's
 * zod-to-JSON-schema conversion requires every top-level key to be present, so `null` is
 * how the model expresses "leave this out". Same convention as buildUpdateAgentPatch in
 * ai/agents.ts. */
export function toolParamsSchema(params: HttpToolParam[]) {
  // A plain mutable record rather than z.ZodRawShape — that alias resolves to a readonly
  // index signature in zod 4, so assigning into it is a type error.
  const shape: Record<string, z.ZodType> = {};
  for (const param of params) {
    const base =
      param.type === "number" ? z.number() : param.type === "boolean" ? z.boolean() : z.string();
    const described = param.description ? base.describe(param.description) : base;
    shape[param.name] = param.required ? described : described.nullable();
  }
  return z.object(shape);
}

/** Joins a collection's base URL to an endpoint path without doubling or dropping the
 * separator — `https://x.dev/` + `/posts` and `https://x.dev` + `posts` both give
 * `https://x.dev/posts`. An empty path leaves the base URL untouched. */
export function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  const suffix = path.trim();
  if (!suffix) return base;
  return `${base}/${suffix.replace(/^\/+/, "")}`;
}

/** Header values are written into the raw request, so a CR or LF would let a crafted
 * parameter value inject additional headers (or a whole second request). Rejected outright
 * rather than stripped, so the failure is visible instead of silently altering intent. */
function assertSafeHeaderValue(name: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`Header "${name}" cannot contain line breaks.`);
  }
}

function stringifyValue(value: Exclude<HttpToolArgValue, null>): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * Resolves one HTTP tool call into a concrete request.
 *
 * Substitution rules, by parameter location:
 *  - path   — replaces `{{name}}` in the path, URL-encoded (so a value containing `/` or
 *             `?` can never escape its segment and reshape the URL)
 *  - query  — appended via URLSearchParams (which handles its own encoding)
 *  - header — set as a request header, rejected if it contains line breaks
 *  - body   — see below
 *
 * Body handling is deliberately JSON-safe in both directions:
 *  - with no `bodyTemplate`, the body is an object built from the body params and passed
 *    through JSON.stringify, so no string concatenation happens at all
 *  - with a `bodyTemplate`, each `{{name}}` is replaced by `JSON.stringify(value)` — which
 *    means placeholders are written *unquoted* (`{"title": {{title}}}`) and come out both
 *    correctly typed and correctly escaped. A value containing a quote cannot break out.
 */
export function buildHttpRequest(options: {
  baseUrl: string;
  path: string;
  method: string;
  params: HttpToolParam[];
  args: Record<string, HttpToolArgValue>;
  /** Collection-level headers, overridden per-key by toolHeaders. */
  collectionHeaders?: Record<string, string>;
  toolHeaders?: Record<string, string>;
  bodyTemplate?: string;
}): BuiltHttpRequest {
  const { baseUrl, path, params, args } = options;
  const method = (options.method || "GET").toUpperCase();

  const provided = new Map<string, Exclude<HttpToolArgValue, null>>();
  for (const param of params) {
    const raw = args[param.name];
    if (raw === undefined || raw === null) {
      if (param.required) {
        throw new Error(`Missing required parameter "${param.name}".`);
      }
      continue;
    }
    provided.set(param.name, raw);
  }

  const byLocation = (location: HttpToolParam["location"]) =>
    params.filter((p) => p.location === location && provided.has(p.name));

  // --- path ---
  let resolvedPath = path;
  for (const param of byLocation("path")) {
    const value = encodeURIComponent(stringifyValue(provided.get(param.name)!));
    resolvedPath = resolvedPath.replace(
      new RegExp(`\\{\\{\\s*${param.name}\\s*\\}\\}`, "g"),
      value
    );
  }
  // A leftover placeholder means the URL would be requested with a literal "{{id}}" in it.
  // Failing loudly beats sending a request that can only 404.
  const leftover = resolvedPath.match(PLACEHOLDER_PATTERN);
  if (leftover) {
    throw new Error(`Unresolved placeholder(s) in path: ${leftover.join(", ")}`);
  }

  const url = new URL(joinUrl(baseUrl, resolvedPath));

  // --- query ---
  for (const param of byLocation("query")) {
    url.searchParams.set(param.name, stringifyValue(provided.get(param.name)!));
  }

  // --- headers ---
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.collectionHeaders ?? {})) {
    assertSafeHeaderValue(key, value);
    headers[key] = value;
  }
  for (const [key, value] of Object.entries(options.toolHeaders ?? {})) {
    assertSafeHeaderValue(key, value);
    headers[key] = value;
  }
  for (const param of byLocation("header")) {
    const value = stringifyValue(provided.get(param.name)!);
    assertSafeHeaderValue(param.name, value);
    headers[param.name] = value;
  }

  // --- body ---
  let body: string | undefined;
  const template = options.bodyTemplate?.trim() ?? "";
  if (template) {
    const substituted = template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
      const value = provided.get(name);
      if (value === undefined) return match;
      return JSON.stringify(value);
    });
    const unresolved = substituted.match(PLACEHOLDER_PATTERN);
    if (unresolved) {
      throw new Error(`Unresolved placeholder(s) in body: ${unresolved.join(", ")}`);
    }
    // Validated here rather than left to the server: a malformed template produces a
    // confusing remote 400, while this names the real problem.
    try {
      JSON.parse(substituted);
    } catch {
      throw new Error("Body template is not valid JSON once its placeholders are filled in.");
    }
    body = substituted;
  } else {
    const bodyParams = byLocation("body");
    if (bodyParams.length > 0) {
      const payload: Record<string, HttpToolArgValue> = {};
      for (const param of bodyParams) {
        payload[param.name] = provided.get(param.name)!;
      }
      body = JSON.stringify(payload);
    }
  }

  // GET/HEAD cannot carry a body (fetch rejects it outright), so body params on a read
  // endpoint would otherwise fail at call time with an opaque TypeError.
  if (body !== undefined && (method === "GET" || method === "HEAD")) {
    throw new Error(`A ${method} request cannot send a body — use query parameters instead.`);
  }
  if (body !== undefined && headers["Content-Type"] === undefined && headers["content-type"] === undefined) {
    headers["Content-Type"] = "application/json";
  }

  return { url: url.toString(), method, headers, body };
}
