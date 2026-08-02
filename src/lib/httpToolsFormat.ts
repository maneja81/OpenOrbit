/** Renderer-side helpers for the HTTP Tools settings UI. Pure — no bridge access — so the
 * parsing rules the forms depend on are unit-testable on their own. */

/** The in-progress endpoint being added or edited. Lives here rather than beside the form
 * component so the component file only exports a component (react-refresh). */
export interface HttpToolDraft {
  name: string;
  description: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  bodyTemplate: string;
  params: HttpToolParam[];
}

export const EMPTY_TOOL_DRAFT: HttpToolDraft = {
  name: "",
  description: "",
  method: "GET",
  path: "",
  headers: {},
  bodyTemplate: "",
  params: [],
};

/** Parses the "one KEY=value per line" textarea into a header map, reusing the exact
 * convention McpServersTab already uses for env vars rather than introducing a second
 * key/value editing idiom. Blank lines and lines with no "=" are skipped; only the first
 * "=" splits, so a value may itself contain "=" (common in tokens). */
export function parseHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    headers[key] = trimmed.slice(eq + 1).trim();
  }
  return headers;
}

export function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/** Mirrors isWriteMethod in electron/main/db/httpToolsStore.ts — the renderer can't import
 * across the tsconfig project boundary. Used only to label a row; the main process never
 * trusts this copy for anything. */
export function isWriteMethod(method: string): boolean {
  return WRITE_METHODS.includes(method.toUpperCase());
}

/** Renderer mirror of methodGroup/requiresApproval in electron/main/ai/approvalPolicy.ts.
 * Main is the authority — it resolves the real decision at call time. This copy exists
 * only so an endpoint row can show whether it will ask, without a round-trip. Keep the two
 * in step; `tsc` cannot check across the project boundary. */
export function willAskApproval(
  method: string,
  policy: { post: boolean; putPatch: boolean; delete: boolean }
): boolean {
  switch (method.trim().toUpperCase()) {
    case "POST":
      return policy.post;
    case "PUT":
    case "PATCH":
      return policy.putPatch;
    case "DELETE":
      return policy.delete;
    default:
      return false;
  }
}

/** Turns the user's sample text inputs into the typed values the endpoint declares, so
 * Test sends `7` for a number parameter rather than the string `"7"`. A blank entry is
 * dropped so an untouched optional parameter is genuinely omitted. */
export function coerceSampleArgs(
  params: HttpToolParam[],
  sampleArgs: Record<string, string>
): Record<string, string | number | boolean | null> {
  const args: Record<string, string | number | boolean | null> = {};
  for (const param of params) {
    const raw = sampleArgs[param.name];
    if (raw === undefined || raw.trim() === "") continue;
    if (param.type === "number") {
      const value = Number(raw);
      // A non-numeric entry is passed through unchanged rather than becoming NaN — the
      // request builder's own error names the problem better than a silent NaN would.
      args[param.name] = Number.isNaN(value) ? raw : value;
    } else if (param.type === "boolean") {
      args[param.name] = raw.trim().toLowerCase() === "true";
    } else {
      args[param.name] = raw;
    }
  }
  return args;
}

/** Short label for a collection row: how many endpoints it exposes, and how many of those
 * will pause for approval under the current global policy. The count moves when the policy
 * changes, since nothing is gated per-endpoint any more. */
export function formatToolCountLabel(
  tools: { enabled: number; method: string }[],
  policy: { post: boolean; putPatch: boolean; delete: boolean }
): string {
  if (tools.length === 0) return "no endpoints yet";
  const enabled = tools.filter((tool) => tool.enabled === 1);
  const gated = enabled.filter((tool) => willAskApproval(tool.method, policy)).length;
  const base = `${enabled.length} of ${tools.length} endpoint${tools.length === 1 ? "" : "s"} on`;
  return gated > 0 ? `${base}, ${gated} ask${gated === 1 ? "s" : ""} first` : base;
}
