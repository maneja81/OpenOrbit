import { getDb } from "./index";
import { devLog } from "../devLog";

/** Returned by parseSettingValue when a row's JSON can't be parsed. A plain `null` won't do:
 * `null` is itself a legitimate stored value, and conflating the two would silently turn a
 * corrupt row into a real setting. */
const UNPARSEABLE = Symbol("unparseable");

/**
 * Parses one row's `setting_value`, degrading to UNPARSEABLE rather than throwing.
 *
 * A single malformed row used to take down every settings read: `getSettingsByPrefix` threw,
 * `settings:get` rejected, and the renderer's useSettings fell back to *all* defaults — so one
 * bad row read as "my entire configuration was wiped", API keys included, with only a devLog
 * line to explain it. The decryption step in ipc/settings.ts already degrades per key for
 * exactly this reason; parsing now matches it.
 *
 * Skipping the key (rather than substituting a value here) is what lets each caller apply its
 * own default, which is the behaviour a missing row already has.
 */
function parseSettingValue(name: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // The name and byte count only — never the value, and never JSON.parse's own message,
    // which echoes up to ~30 characters of its input ("Unexpected token 'h', \"https://ap\"…").
    // devLog writes to userData/debug.log, the file users are asked to attach to bug reports,
    // and a half-written appSettings.chatApiUrl row can carry credentials in its query string.
    // Length is enough to tell "empty row" from "truncated write" without echoing content.
    devLog(`[settings] skipping ${name}: value is not valid JSON (${raw?.length ?? 0} bytes)`);
    return UNPARSEABLE;
  }
}

export function getSetting<T>(name: string, defaultValue: T): T {
  const db = getDb();
  const row = db.prepare("SELECT setting_value FROM settings WHERE setting_name = ?").get(name) as
    | { setting_value: string }
    | undefined;
  if (!row) return defaultValue;
  const value = parseSettingValue(name, row.setting_value);
  return value === UNPARSEABLE ? defaultValue : (value as T);
}

export function setSetting(name: string, value: unknown): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO settings (setting_name, setting_value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(setting_name) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at`
  ).run(name, JSON.stringify(value));
}

/** Reads every row whose name starts with `prefix`, returning an object keyed by the name with the prefix stripped. */
export function getSettingsByPrefix(prefix: string): Record<string, unknown> {
  const db = getDb();
  const rows = db
    .prepare("SELECT setting_name, setting_value FROM settings WHERE setting_name LIKE ?")
    .all(`${prefix}%`) as { setting_name: string; setting_value: string }[];
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    const value = parseSettingValue(row.setting_name, row.setting_value);
    // Omit rather than include-as-undefined: mergeWithDefaults spreads this object over the
    // defaults, and an explicit `undefined` key would override the default it should fall back to.
    if (value === UNPARSEABLE) continue;
    result[row.setting_name.slice(prefix.length)] = value;
  }
  return result;
}

/** Deletes every row whose name starts with `prefix`. */
export function deleteSettingsByPrefix(prefix: string): void {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE setting_name LIKE ?").run(`${prefix}%`);
}
