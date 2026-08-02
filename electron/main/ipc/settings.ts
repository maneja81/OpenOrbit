import { ipcMain } from "electron";
import { setSetting, getSettingsByPrefix } from "../db/settingsStore";
import { encryptSecret, decryptSecret } from "../security/secretStorage";
import { getDb } from "../db";
import { runMigrations } from "../db/migrations";
import { DEFAULT_MODEL } from "../ai/agents";
import { testChatConnection, testVoiceConnection } from "../ai/provider";
import { devLog } from "../devLog";
import { validateSettingsPatch } from "../settingsSchema";

const NAMESPACE = "appSettings.";
// Chat and Voice are independent credential slots (Settings → AI Models), each encrypted
// the same way the single aiProviderApiKey used to be. Connector-specific secrets (e.g.
// Gmail's OAuth client id/secret) live per-connector in the connectors table instead of
// here — see connectorsStore.saveConnectorSettings.
const SENSITIVE_KEYS = ["chatApiKey", "voiceApiKey"];
// Not encrypted, but never written to debug.log either: some OpenAI-compatible hosts carry the
// credential in the URL's query string, and that file is what users attach to bug reports.
const REDACTED_VALUE_KEYS = ["chatApiUrl", "voiceApiUrl", "orchestratorPromptOverride"];
// The orchestrator is singular and can't be turned off — enforced here (not just
// greyed out in the UI) so the setting can never end up false regardless of caller.
const LOCKED_KEYS = ["orchestratorEnabled"];

function getDecryptedSettings(): Record<string, unknown> {
  const settings = getSettingsByPrefix(NAMESPACE);
  for (const sensitiveKey of SENSITIVE_KEYS) {
    if (typeof settings[sensitiveKey] === "string" && settings[sensitiveKey].length > 0) {
      try {
        settings[sensitiveKey] = decryptSecret(settings[sensitiveKey] as string);
      } catch (e) {
        // OS-backed decryption can throw (locked keychain, migrated userData to a new
        // machine/user, libsecret daemon down) — must not take down settings:get/update
        // entirely, since the renderer gates the whole app's render on settings loading
        // successfully. Surface as unset rather than crashing; the user can re-enter the key.
        devLog(`[settings] failed to decrypt ${sensitiveKey}: ${e instanceof Error ? e.message : String(e)}`);
        settings[sensitiveKey] = "";
      }
    }
  }
  return settings;
}

export function registerSettingsHandlers() {
  ipcMain.handle("settings:get", (): Record<string, unknown> => getDecryptedSettings());

  ipcMain.handle("settings:testChat", () => testChatConnection());
  ipcMain.handle("settings:testVoice", () => testVoiceConnection());

  ipcMain.handle("settings:update", (_event, patch: Record<string, unknown>): Record<string, unknown> => {
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      throw new Error("settings:update requires a plain object patch");
    }

    // Every entry is checked against settingsSchema before it can reach the database. Until
    // this existed the handler persisted whatever it was handed: an unknown key became a real
    // row, and a value of the wrong type landed in a field its consumers assume the type of.
    // ConfigAgent's update_setting has always validated; this path — the one the entire
    // Settings UI uses, and the less trusted of the two — did not.
    const { accepted, rejected } = validateSettingsPatch(patch);
    for (const failure of rejected) {
      // Logged rather than thrown: a Settings screen sends one field at a time, so failing the
      // whole call would discard the good entries alongside the bad one. The handler returns
      // the authoritative post-write state either way, and useSettings reconciles against it,
      // so a refused value visibly snaps back instead of appearing to have been saved.
      devLog(`[settings:update] refused ${NAMESPACE}${failure.key}: ${failure.reason}`);
    }

    for (const [key, value] of Object.entries(accepted)) {
      if (LOCKED_KEYS.includes(key)) continue;
      if (SENSITIVE_KEYS.includes(key) && typeof value === "string" && value.length > 0) {
        setSetting(NAMESPACE + key, encryptSecret(value));
        devLog(`[settings:update] ${NAMESPACE}${key} = (redacted)`);
      } else if (key === "orchestratorModel") {
        // Schema validation allows "" here (clearing the field); the fallback to a real model
        // id is applied on write so no consumer has to treat empty as a special case.
        const model = typeof value === "string" && value.length > 0 ? value : DEFAULT_MODEL;
        setSetting(NAMESPACE + key, model);
        devLog(`[settings:update] ${NAMESPACE}${key} = ${model}`);
      } else {
        setSetting(NAMESPACE + key, value);
        // URL fields can carry credentials in a query string, and devLog writes to
        // userData/debug.log — the file users attach to bug reports. Only the two API *keys*
        // were redacted before.
        devLog(`[settings:update] ${NAMESPACE}${key} = ${REDACTED_VALUE_KEYS.includes(key) ? "(redacted)" : value}`);
      }
    }
    return getDecryptedSettings();
  });

  // Danger Zone: drops every app-owned table (settings, agents, chat history, memory,
  // knowledge base, token usage) and re-runs migrations from scratch, so the app comes
  // back with the exact fresh schema + seed state a brand-new install would have.
  // File-based app dirs (mcp/skills/workflows/user under userData) are intentionally
  // left on disk — this only resets the SQLite-backed state.
  ipcMain.handle("settings:reset", (): Record<string, unknown> => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    // foreign_keys is a no-op when toggled inside a transaction, so it must be
    // flipped off before BEGIN — otherwise dropping a referenced table (e.g.
    // conversations, before its dependent messages table) would throw.
    db.pragma("foreign_keys = OFF");
    const dropAndReseed = db.transaction(() => {
      for (const { name } of tables) {
        db.prepare(`DROP TABLE IF EXISTS "${name}"`).run();
      }
      db.pragma("user_version = 0");
    });
    dropAndReseed();
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    return getDecryptedSettings();
  });
}
