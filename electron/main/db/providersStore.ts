import { getDb } from "./index";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { devLog } from "../devLog";

/**
 * Credentials for one AI provider, keyed by the registry id in ai/providers.ts.
 *
 * One row per provider rather than per agent or per slot: an agent can run on a different
 * provider than the orchestrator, and per-agent storage would mean one copy of the same secret
 * for every agent pointed at it — N places to rotate, N places to miss.
 *
 * Keys are encrypted at rest with the same AES-256-GCM helper the settings table uses. That is
 * obfuscation, not protection — the encryption key lives in this same database file, which is
 * documented and deliberate in security/secretStorage.ts.
 */

export interface ProviderRow {
  id: string;
  api_url: string;
  /** Ciphertext as stored. Never hand this to a caller — see getProviderCredentials. */
  api_key: string;
  updated_at: string;
}

/** What the renderer is allowed to see: the URL, and whether a key exists — never its value.
 * Same shape, and the same reasoning, as settings:get's chatApiKeySet/voiceApiKeySet. */
export interface VisibleProvider {
  id: string;
  apiUrl: string;
  keySet: boolean;
}

export interface ProviderCredentials {
  apiUrl: string;
  /** Decrypted. Empty when unset, or when decryption failed — callers must treat empty as
   * "not configured" rather than assuming a key is present. */
  apiKey: string;
}

/**
 * Decrypts one stored key, degrading to "" rather than throwing.
 *
 * OS-backed decryption can fail for reasons that have nothing to do with this row — a userData
 * directory copied to another machine, a locked keychain. The settings path already learned this
 * (see getDecryptedSettings in ipc/settings.ts): the renderer gates the whole app's render on
 * settings loading, so a throw here would show a blank window rather than a re-enterable field.
 */
function decryptOrEmpty(id: string, stored: string): string {
  if (stored === "") return "";
  try {
    return decryptSecret(stored);
  } catch (e) {
    // Never the value itself — devLog writes to userData/debug.log, the file users attach to bug
    // reports.
    devLog(`[providers] failed to decrypt key for ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return "";
  }
}

/** Every configured provider, safe to send over IPC. */
export function listVisibleProviders(): VisibleProvider[] {
  const rows = getDb().prepare("SELECT id, api_url, api_key FROM providers ORDER BY id").all() as ProviderRow[];
  return rows.map((row) => ({
    id: row.id,
    apiUrl: row.api_url,
    // Deliberately the stored ciphertext's length, not the decrypted value's: whether a key is
    // configured is a fact about the row, and a key that currently fails to decrypt is still
    // configured. Reporting it as unset would invite the user to overwrite a recoverable key.
    keySet: row.api_key.length > 0,
  }));
}

/** Main-process only — this returns the decrypted key and must never cross the IPC boundary. */
export function getProviderCredentials(id: string): ProviderCredentials | null {
  const row = getDb().prepare("SELECT id, api_url, api_key FROM providers WHERE id = ?").get(id) as
    | ProviderRow
    | undefined;
  if (!row) return null;
  return { apiUrl: row.api_url, apiKey: decryptOrEmpty(id, row.api_key) };
}

/** Whether a provider has both of the things a request needs. `local` is the exception the
 * `keyRequired` flag exists for, so callers that care check the registry too. */
export function isProviderConfigured(id: string): boolean {
  const row = getDb().prepare("SELECT api_key FROM providers WHERE id = ?").get(id) as
    | { api_key: string }
    | undefined;
  return row !== undefined && row.api_key.length > 0;
}

export interface SaveProviderInput {
  apiUrl?: string;
  /**
   * Three-state on purpose:
   *  - `undefined` — leave the stored key alone. This is what a Settings save sends when the
   *    user edited only the URL, and what an untouched masked field sends on blur.
   *  - `""` — clear it. The only way to remove a key without the Danger Zone's full wipe.
   *  - anything else — replace it, encrypting on the way in.
   */
  apiKey?: string;
}

/** Upsert. Creates the row on first save so a provider only exists once it is configured. */
export function saveProvider(id: string, input: SaveProviderInput): void {
  const db = getDb();
  const existing = db.prepare("SELECT id, api_url, api_key FROM providers WHERE id = ?").get(id) as
    | ProviderRow
    | undefined;

  const apiUrl = input.apiUrl ?? existing?.api_url ?? "";
  const apiKey =
    input.apiKey === undefined
      ? (existing?.api_key ?? "")
      : input.apiKey === ""
        ? ""
        : encryptSecret(input.apiKey);

  db.prepare(
    `INSERT INTO providers (id, api_url, api_key, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       api_url = excluded.api_url,
       api_key = excluded.api_key,
       updated_at = excluded.updated_at`
  ).run(id, apiUrl, apiKey);
}

/** Forgets a provider's credentials entirely. Separate from `saveProvider(id, {apiKey: ""})`,
 * which keeps the row and its URL — this is for "I am not using this provider at all". */
export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}
