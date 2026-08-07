/**
 * Dev-only convenience: `npm run dev -- --user-data-dir=<path> --env=<path>` seeds Settings from
 * a plain KEY=VALUE file before the window opens, so a throwaway `--user-data-dir` profile
 * doesn't need onboarding driven by hand on every run. `--user-data-dir` itself needs no code
 * here — it's a Chromium switch Electron already honors; this module only handles `--env`.
 *
 * Never wired into a packaged build (the `is.dev` guard in index.ts), and never overwrites a
 * profile that has already completed onboarding, so pointing a stale --env file at a real dev
 * profile with its own configured settings is a no-op rather than a silent overwrite.
 */

import { existsSync, readFileSync } from "node:fs";
import { getSetting, setSetting } from "./db/settingsStore";
import { saveProvider } from "./db/providersStore";
import { saveConnectorSettings, getDecryptedSettings as getConnectorSettings } from "./db/connectorsStore";
import { getConnectorDefinition } from "./connectors/registry";
import { encryptSecret } from "./security/secretStorage";
import { validateSettingsPatch, SETTINGS_SCHEMA, type SettingKey } from "./settingsSchema";
import { devLog } from "./devLog";

const NAMESPACE = "appSettings.";
const SENSITIVE_KEYS = ["chatApiKey", "voiceApiKey"];

function parseEnvArg(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--env=")) return arg.slice("--env=".length);
    if (arg === "--env") return argv[i + 1];
  }
  return undefined;
}

function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function isSettingKey(key: string): key is SettingKey {
  return key in SETTINGS_SCHEMA;
}

/** The seed file only has strings; boolean/number settings need coercion before validation,
 * which otherwise requires the real type (see settingsSchema.validateSettingValue). */
function coerce(key: string, raw: string): unknown {
  if (!isSettingKey(key)) return raw;
  const kind = SETTINGS_SCHEMA[key].type;
  if (kind === "boolean") return raw.toLowerCase() === "true";
  if (kind === "number") return Number(raw);
  if (kind === "stringArray") return raw.split(",").map((entry) => entry.trim());
  return raw;
}

const GOOGLE_ACCOUNT_CONNECTOR_ID = "google-account";

/**
 * Seeds the Google Account connector's shared OAuth Client ID/Secret from
 * `googleClientId`/`googleClientSecret` in the env file — every Google connector (Gmail,
 * Calendar, Drive, Contacts) reads credentials from this one connector id
 * (googleAccountConnector.ts), so seeding it here unblocks all four at once.
 *
 * This only pre-fills the Settings → Connectors fields; it cannot complete a connection.
 * The OAuth consent screen opens the real system browser via shell.openExternal, entirely
 * outside anything this process can drive — connecting still needs one manual click per
 * service after the app launches.
 */
function seedGoogleConnector(raw: Record<string, string>): void {
  const clientId = raw.googleClientId;
  const clientSecret = raw.googleClientSecret;
  if (!clientId && !clientSecret) return;

  const definition = getConnectorDefinition(GOOGLE_ACCOUNT_CONNECTOR_ID);
  if (!definition) return; // should be unreachable — registry always has this entry

  if (getConnectorSettings(GOOGLE_ACCOUNT_CONNECTOR_ID)) {
    devLog(`[devSeed] ${GOOGLE_ACCOUNT_CONNECTOR_ID} already has settings — skipping seed`);
    return;
  }

  // Same mutable-field filter connectors:saveSettings applies — readonly fields (redirectUri)
  // are display-only and must never be persisted.
  const mutableKeys = new Set(definition.settingsFields.filter((f) => f.type !== "readonly").map((f) => f.key));
  const settings: Record<string, string> = {};
  if (clientId !== undefined && mutableKeys.has("clientId")) settings.clientId = clientId;
  if (clientSecret !== undefined && mutableKeys.has("clientSecret")) settings.clientSecret = clientSecret;

  saveConnectorSettings(GOOGLE_ACCOUNT_CONNECTOR_ID, GOOGLE_ACCOUNT_CONNECTOR_ID, settings);
  devLog(`[devSeed] seeded ${GOOGLE_ACCOUNT_CONNECTOR_ID} connector settings`);
}

export function applyDevEnvSeed(argv: string[]): void {
  const envPath = parseEnvArg(argv);
  if (!envPath) return;
  if (!existsSync(envPath)) {
    devLog(`[devSeed] --env file not found: ${envPath}`);
    return;
  }
  const raw = parseEnvFile(readFileSync(envPath, "utf8"));

  // Connector settings have their own lifecycle, independent of onboarding — seeded (and
  // guarded against overwrite) regardless of whether Settings onboarding already ran.
  seedGoogleConnector(raw);

  if (getSetting(NAMESPACE + "onboardingDone", false)) {
    devLog(`[devSeed] onboarding already completed on this profile — skipping settings seed`);
    return;
  }

  // googleClientId/googleClientSecret are handled by seedGoogleConnector above; left in `rest`
  // here, they're simply refused by validateSettingsPatch as unknown settings keys (logged, not
  // persisted) since neither is in SETTINGS_SCHEMA.
  const { chatProviderId, chatApiKey, chatApiUrl, ...rest } = raw;
  const settingsRaw: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    settingsRaw[key] = coerce(key, value);
  }

  // A non-empty chatProviderId routes credentials through the providers table instead of the
  // legacy chatApiKey/chatApiUrl settings pair — see provider.ts's resolveSlot. Mirroring that
  // split here so a seeded provider id actually resolves to a working chat slot.
  if (chatProviderId) {
    saveProvider(chatProviderId, { apiUrl: chatApiUrl, apiKey: chatApiKey });
    settingsRaw.chatProviderId = chatProviderId;
  } else {
    if (chatApiKey !== undefined) settingsRaw.chatApiKey = chatApiKey;
    if (chatApiUrl !== undefined) settingsRaw.chatApiUrl = chatApiUrl;
  }

  const { accepted, rejected } = validateSettingsPatch(settingsRaw);
  for (const failure of rejected) {
    devLog(`[devSeed] refused ${NAMESPACE}${failure.key}: ${failure.reason}`);
  }
  for (const [key, value] of Object.entries(accepted)) {
    if (SENSITIVE_KEYS.includes(key) && typeof value === "string" && value.length > 0) {
      setSetting(NAMESPACE + key, encryptSecret(value));
    } else {
      setSetting(NAMESPACE + key, value);
    }
    devLog(`[devSeed] ${NAMESPACE}${key} seeded from ${envPath}`);
  }
}
