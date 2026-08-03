import { devLog } from "../devLog";

/** Returned by parseJsonColumn when a column's JSON can't be parsed. A plain `null` won't do:
 * `null` is itself a legitimate stored value, and conflating the two would silently turn a
 * corrupt row into a real one. */
export const UNPARSEABLE = Symbol("unparseable");

/**
 * Parses a JSON-encoded column value, degrading to UNPARSEABLE rather than throwing.
 *
 * The key/value stores here hold JSON.stringify'd content in a TEXT column, so a row that
 * isn't valid JSON is always possible — a partial write, a hand-edited database, or a value
 * written by a path that forgot to stringify. Parsing inline meant one such row took down
 * every read of the whole table: settingsStore's getSettingsByPrefix threw, `settings:get`
 * rejected, and the renderer fell back to *all* defaults, so one bad row read as "my entire
 * configuration was wiped".
 *
 * Skipping the row (rather than substituting a value here) is what lets each caller apply its
 * own default, which is the behaviour a missing row already has.
 */
export function parseJsonColumn(label: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // The label and byte count only — never the value, and never JSON.parse's own message,
    // which echoes up to ~30 characters of its input ("Unexpected token 'h', \"https://ap\"…").
    // devLog writes to userData/debug.log, the file users are asked to attach to bug reports,
    // and a half-written appSettings.chatApiUrl row can carry credentials in its query string.
    // Length is enough to tell "empty row" from "truncated write" without echoing content.
    devLog(`[db] skipping ${label}: value is not valid JSON (${raw?.length ?? 0} bytes)`);
    return UNPARSEABLE;
  }
}

/**
 * A JSON id-array column, degrading to an empty list.
 *
 * Four tables store attachments this way (agents.mcp_server_ids, connector_ids,
 * http_tool_collection_ids). Callers immediately `.includes()` or iterate the result, so a
 * corrupt row is not just unparseable — a parsed non-array would throw one line later. "Nothing
 * attached" is the safe reading of both.
 */
export function parseIdList(label: string, raw: string): string[] {
  const parsed = parseJsonColumn(label, raw);
  if (parsed === UNPARSEABLE) return [];
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
    devLog(`[db] ignoring ${label}: not an array of ids`);
    return [];
  }
  return parsed;
}

/**
 * A JSON string-map column, degrading to an empty map. Used for the encrypted header/env maps and
 * a task's recurrence params, all of which are iterated by their callers.
 */
export function parseStringMap(label: string, raw: string): Record<string, string> {
  const parsed = parseJsonColumn(label, raw);
  if (parsed === UNPARSEABLE) return {};
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    devLog(`[db] ignoring ${label}: not an object`);
    return {};
  }
  return parsed as Record<string, string>;
}
