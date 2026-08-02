import { getDb } from "./index";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { UNPARSEABLE, parseIdList, parseJsonColumn } from "./jsonColumn";

export interface ConnectorCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // epoch ms
  scope?: string;
}

export interface ConnectorRow {
  id: string;
  type: string;
  status: "connected" | "disconnected";
  account_label: string | null;
  created_at: string;
  updated_at: string;
  /** 1 if user-entered settings (client id/secret/etc.) have ever been saved, else 0 —
   * a non-secret existence flag so callers can check "is this connector configured"
   * without decrypting, preserving the "decrypt only right before use" rule below. */
  has_settings: number;
}

const ROW_COLUMNS = "id, type, status, account_label, created_at, updated_at, settings IS NOT NULL AS has_settings";

export function listConnectors(): ConnectorRow[] {
  const db = getDb();
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM connectors ORDER BY created_at ASC`).all() as ConnectorRow[];
}

export function getConnector(id: string): ConnectorRow | undefined {
  const db = getDb();
  return db.prepare(`SELECT ${ROW_COLUMNS} FROM connectors WHERE id = ?`).get(id) as ConnectorRow | undefined;
}

/** Reads and decrypts one connector's stored credentials — only called right before a
 * tool actually needs to make an API call, same "decrypt on demand, never in bulk" rule
 * as mcp.ts's getDecryptedEnv. Returns null if the connector doesn't exist or was never
 * connected (no credentials stored yet). */
export function getDecryptedCredentials(id: string): ConnectorCredentials | null {
  const db = getDb();
  const row = db.prepare("SELECT credentials FROM connectors WHERE id = ?").get(id) as
    | { credentials: string | null }
    | undefined;
  if (!row || !row.credentials) return null;
  const parsed = parseJsonColumn(`connectors ${id}/credentials`, decryptSecret(row.credentials));
  // null is already how this says "not configured", and every caller handles it — so a row that
  // cannot be read reports the same thing rather than taking the connector surface down.
  return parsed === UNPARSEABLE ? null : (parsed as ConnectorCredentials);
}

/** Persists a connector as connected — inserts the row if this is the first time this
 * connector type has ever been authorized, otherwise updates its stored credentials in
 * place. Credentials are encrypted as one JSON blob (access/refresh token, expiry, scope)
 * rather than per-field, since they're always read/written together. */
export function saveConnectorCredentials(
  id: string,
  type: string,
  credentials: ConnectorCredentials,
  accountLabel?: string
): ConnectorRow {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(credentials));
  db.prepare(
    `INSERT INTO connectors (id, type, status, account_label, credentials, updated_at)
     VALUES (?, ?, 'connected', ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       status = 'connected',
       account_label = excluded.account_label,
       credentials = excluded.credentials,
       updated_at = datetime('now')`
  ).run(id, type, accountLabel ?? null, encrypted);
  return getConnector(id) as ConnectorRow;
}

/** Reads and decrypts one connector's user-entered settings (client id/secret/etc.) —
 * same "decrypt on demand, never in bulk" rule as getDecryptedCredentials. Returns null
 * if the connector doesn't exist or has no settings saved yet. */
export function getDecryptedSettings(id: string): Record<string, string> | null {
  const db = getDb();
  const row = db.prepare("SELECT settings FROM connectors WHERE id = ?").get(id) as
    | { settings: string | null }
    | undefined;
  if (!row || !row.settings) return null;
  const parsed = parseJsonColumn(`connectors ${id}/settings`, decryptSecret(row.settings));
  return parsed === UNPARSEABLE ? null : (parsed as Record<string, string>);
}

/** Persists a connector's user-entered settings (client id/secret/etc.), independent of
 * connection status — works even before the connector has ever been connected (first
 * insert defaults to 'disconnected', matching a fresh row), and does not touch
 * status/credentials on conflict so saving settings never disturbs an existing
 * connection. */
export function saveConnectorSettings(id: string, type: string, settings: Record<string, string>): void {
  const db = getDb();
  const encrypted = encryptSecret(JSON.stringify(settings));
  db.prepare(
    `INSERT INTO connectors (id, type, settings, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       settings = excluded.settings,
       updated_at = datetime('now')`
  ).run(id, type, encrypted);
}

/** Disconnects a connector: clears its stored credentials and sweeps it out of every
 * agent's connector_ids, so a disconnected connector never lingers as a dangling id that
 * silently fails to attach on the next agent run — same precedent as mcp.ts's
 * deleteMcpServer detach sweep. */
export function disconnectConnector(id: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE connectors SET status = 'disconnected', credentials = NULL, account_label = NULL, updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  const agents = db.prepare("SELECT id, connector_ids FROM agents").all() as { id: string; connector_ids: string }[];
  for (const agent of agents) {
    const ids = parseIdList(`agents ${agent.id}/connector_ids`, agent.connector_ids);
    if (!ids.includes(id)) continue;
    db.prepare("UPDATE agents SET connector_ids = ? WHERE id = ?").run(
      JSON.stringify(ids.filter((existingId) => existingId !== id)),
      agent.id
    );
  }
}
