import { getDb } from "./index";

/** Per-agent key/value store, scoped by agent_id — see migrations.ts v24 (agent_data table). */

export function getAgentData<T>(agentId: string, key: string, defaultValue: T): T {
  const db = getDb();
  const row = db.prepare("SELECT value FROM agent_data WHERE agent_id = ? AND key = ?").get(agentId, key) as
    | { value: string }
    | undefined;
  if (!row) return defaultValue;
  return JSON.parse(row.value) as T;
}

export function setAgentData(agentId: string, key: string, value: unknown): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO agent_data (agent_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(agentId, key, JSON.stringify(value));
}

/** Reads every key/value pair stored for one agent, returning an object keyed by key. */
export function listAgentData(agentId: string): Record<string, unknown> {
  const db = getDb();
  const rows = db.prepare("SELECT key, value FROM agent_data WHERE agent_id = ?").all(agentId) as {
    key: string;
    value: string;
  }[];
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value);
  }
  return result;
}

export function deleteAgentData(agentId: string, key: string): void {
  const db = getDb();
  db.prepare("DELETE FROM agent_data WHERE agent_id = ? AND key = ?").run(agentId, key);
}
