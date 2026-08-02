import { getDb } from "./index";

export function getSetting<T>(name: string, defaultValue: T): T {
  const db = getDb();
  const row = db.prepare("SELECT setting_value FROM settings WHERE setting_name = ?").get(name) as
    | { setting_value: string }
    | undefined;
  if (!row) return defaultValue;
  return JSON.parse(row.setting_value) as T;
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
    result[row.setting_name.slice(prefix.length)] = JSON.parse(row.setting_value);
  }
  return result;
}

/** Deletes every row whose name starts with `prefix`. */
export function deleteSettingsByPrefix(prefix: string): void {
  const db = getDb();
  db.prepare("DELETE FROM settings WHERE setting_name LIKE ?").run(`${prefix}%`);
}
