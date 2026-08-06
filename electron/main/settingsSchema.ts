/**
 * The shape of every persisted app setting, and the one place a value is checked before it
 * reaches the database.
 *
 * There are two write paths — the `settings:update` IPC handler (the whole Settings UI) and
 * ConfigAgent's `update_setting` tool — and until this module existed only the second one
 * validated anything. `settings:update` took any key with any value and JSON.stringify'd it
 * straight into the settings table, so a typo'd key persisted silently, a number could land in
 * a field every consumer calls string methods on, and nothing stopped a caller from filling the
 * table with rows the app has never heard of.
 *
 * The two paths deliberately keep *different key lists* — the agent may write far fewer keys
 * than the user can — but they now share one definition of what a valid value looks like, so a
 * value the agent would be told off for cannot slip in through the UI instead.
 *
 * Mirrors `AgentsSettings` in `src/lib/settings.ts`. It cannot import it: `electron/` and `src/`
 * are separate TypeScript projects and main has no path into the renderer's tree, which is the
 * same reason main re-declares the defaults it reads (see finding S1). Keep the two in step by
 * hand — `settingsSchema.test.ts` asserts the key list against the documented count so an added
 * setting that never reaches here fails loudly rather than being silently unwritable.
 */

import { PROVIDER_IDS } from "./ai/providers";

/** How a setting's value is validated. `model` is a string with the loose "model" or
 * "provider/model" shape; `enum` restricts to a fixed set. */
export type SettingKind =
  | { type: "string"; maxLength?: number; singleLine?: boolean; nonEmpty?: boolean }
  | { type: "model" }
  | { type: "url" }
  | { type: "boolean" }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "stringArray" }
  | { type: "enum"; values: readonly string[] };

const STRING: SettingKind = { type: "string" };

/**
 * A value that is interpolated into system prompts.
 *
 * `{{agentName}}` and `{{userName}}` land in the opening line of every prompt the app builds —
 * thirteen places across five files — and all three of these are writable by ConfigAgent, which
 * is a feature: renaming the orchestrator by chat is a thing people do.
 *
 * The risk is the value, not the permission. Unbounded and multi-line, injected text could set
 * agentName to something that reads as a new prompt section and it would sit at the top of every
 * system prompt from then on. A name is short and fits on one line, so saying so costs the user
 * nothing and removes the room to write instructions.
 */
const promptField = (maxLength: number, nonEmpty = false): SettingKind => ({
  type: "string",
  maxLength,
  singleLine: true,
  nonEmpty,
});
const URL_KIND: SettingKind = { type: "url" };
const BOOLEAN: SettingKind = { type: "boolean" };
const MODEL: SettingKind = { type: "model" };
const STRING_ARRAY: SettingKind = { type: "stringArray" };

/**
 * Which provider a credential slot is pointed at.
 *
 * `""` is a real, meaningful value and the default: it means "this slot has not been moved to
 * the provider registry yet — read the legacy chatApiKey/chatApiUrl pair instead". That is what
 * keeps every install predating the registry behaving exactly as it did, and why this is an enum
 * over the ids *plus* empty rather than a plain string.
 *
 * Imported from ai/providers.ts rather than restated so a provider added there is immediately
 * writable here; that module is pure data with no imports of its own, which is the same property
 * that lets this one stay dependency-free enough for the renderer's parity test to load it.
 */
const PROVIDER_ID_KIND: SettingKind = { type: "enum", values: ["", ...PROVIDER_IDS] };

/** Same loose shape ConfigAgent's update_setting has always applied to model ids: "model" or
 * "provider/model". Deliberately permissive — the catalogue depends on whichever
 * OpenAI-compatible host the user pointed at, so this only rejects things that cannot be a
 * model id at all.
 *
 * Exported because agents.ts validates a sub-agent's `model` column against the same shape.
 * It lives here rather than there so there is one copy: this module has no heavy imports, so
 * agents.ts can depend on it, and not the other way round.
 *
 * The optional leading `~` is OpenRouter's syntax for a floating "latest" alias
 * (`~deepseek/deepseek-v4-flash-latest`), which is a real id: it is listed by their `/models`
 * and returns 200, while the same id without the tilde is refused as "not a valid model ID".
 * Without this character the app's own default for that provider could not be persisted through
 * either write path — the value would be silently refused by `settings:update` and land as a
 * `[settings:update] refused` line in debug.log. Anchored to the start rather than added to the
 * character classes, so it stays a prefix marker and cannot appear mid-id.
 *
 * `:` is allowed in the first segment as well as after a `/`. Restricting it to the second was an
 * OpenRouter-shaped assumption: Ollama names models `name:tag` with no vendor prefix at all
 * (`llama3.2:3b`, `qwen2.5:7b`), which is the normal convention there, so without this the Local
 * AI provider could not be pointed at most of the models a user actually has installed. */
export const MODEL_ID_PATTERN = /^~?[a-z0-9._:-]+(\/[a-z0-9._:-]+)?$/i;

/** Bounds here are the ones the Settings UI already claims via `min` on its number inputs.
 * `min` constrains a spinner and nothing else — typed and pasted values sail straight past it,
 * which is findings S2/S3/S4. Enforcing them at the write boundary is what makes the UI's
 * promise real; clamping on *read* is X3 and still worth doing for rows written before this. */
export const SETTINGS_SCHEMA = {
  chatApiKey: STRING,
  chatApiUrl: URL_KIND,
  voiceApiKey: STRING,
  voiceApiUrl: URL_KIND,
  chatProviderId: PROVIDER_ID_KIND,
  voiceProviderId: PROVIDER_ID_KIND,
  voiceInputEnabled: BOOLEAN,
  typeAnywhereEnabled: BOOLEAN,
  onboardingDone: BOOLEAN,
  tourCompleted: BOOLEAN,
  agentName: promptField(60, true),
  agentDescription: promptField(200),
  orchestratorPromptOverride: STRING,
  userName: promptField(60),
  orchestratorModel: MODEL,
  orchestratorEnabled: BOOLEAN,
  orchestratorMcpServerIds: STRING_ARRAY,
  orchestratorConnectorIds: STRING_ARRAY,
  orchestratorHttpToolCollectionIds: STRING_ARRAY,
  httpToolApprovalPost: BOOLEAN,
  httpToolApprovalPutPatch: BOOLEAN,
  httpToolApprovalDelete: BOOLEAN,
  toolApprovalDisplay: { type: "enum", values: ["modal", "inline"] },
  voiceTranscriptionModel: MODEL,
  voiceOutputEnabled: BOOLEAN,
  soundFxEnabled: BOOLEAN,
  voiceTtsModel: MODEL,
  locationEnabled: BOOLEAN,
  remoteImagesAutoLoad: BOOLEAN,
  bgMusicEnabled: BOOLEAN,
  voiceTtsVoice: { type: "enum", values: ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] },
  agentRunTimeoutSeconds: { type: "number", min: 5, max: 3600, integer: true },
  chatHistoryMessageLimit: { type: "number", min: 1, max: 200, integer: true },
  bgMusicVolume: { type: "number", min: 0, max: 1 },
  systemStatsPollIntervalMs: { type: "number", min: 500, max: 600_000, integer: true },
  soundVariantSend: { type: "number", min: 1, max: 5, integer: true },
  soundVariantReceive: { type: "number", min: 1, max: 5, integer: true },
  soundVariantHandoff: { type: "number", min: 1, max: 5, integer: true },
  soundVariantComplete: { type: "number", min: 1, max: 5, integer: true },
  soundVariantStartup: { type: "number", min: 1, max: 5, integer: true },
  soundVariantAgentCreated: { type: "number", min: 1, max: 5, integer: true },
  soundVariantAgentDeleted: { type: "number", min: 1, max: 5, integer: true },
  soundVariantConsult: { type: "number", min: 1, max: 5, integer: true },
  chatVisibleConversations: { type: "number", min: 1, max: 50, integer: true },
} as const satisfies Record<string, SettingKind>;

export type SettingKey = keyof typeof SETTINGS_SCHEMA;

/** The runtime type a setting holds, derived from its declared kind — so `readAppSetting` returns
 * `boolean` for a toggle and `number` for a tunable without every caller re-stating it. Enum and
 * model kinds are strings; widened deliberately, since the value comes from the database and a
 * literal union would be a promise this layer can't keep. */
export type SettingValue<K extends SettingKey> = (typeof SETTINGS_SCHEMA)[K] extends { type: "boolean" }
  ? boolean
  : (typeof SETTINGS_SCHEMA)[K] extends { type: "number" }
    ? number
    : (typeof SETTINGS_SCHEMA)[K] extends { type: "stringArray" }
      ? string[]
      : string;

/**
 * What each setting is when the user has never touched it.
 *
 * Must stay identical to `DEFAULT_SETTINGS` in `src/lib/settings.ts`. It cannot import it —
 * `electron/` and `src/` are separate TypeScript projects and main has no path into the
 * renderer's tree — so `src/lib/settingsDefaults.test.ts` asserts the two are deep-equal from
 * the renderer side, where both are reachable. That test is the mechanism; this comment is not.
 *
 * Before this existed, every main-side read passed its own default inline
 * (`getSetting("appSettings.voiceInputEnabled", false)`), and two of them disagreed with the
 * renderer: `voiceInputEnabled` and `typeAnywhereEnabled` were `true` in `DEFAULT_SETTINGS` and
 * `false` here. Migrations never seed those rows, so on a fresh install the Settings toggle read
 * "on" while the orchestrator's own view of the setting was "off" — and the orchestrator was the
 * one telling the truth about what main would do.
 */
export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  chatApiKey: "",
  chatApiUrl: "",
  voiceApiKey: "",
  voiceApiUrl: "",
  chatProviderId: "",
  voiceProviderId: "",
  voiceInputEnabled: true,
  typeAnywhereEnabled: true,
  onboardingDone: false,
  tourCompleted: false,
  agentName: "Orbit",
  agentDescription: "Your personal AI orchestrator.",
  orchestratorPromptOverride: "",
  userName: "",
  orchestratorModel: "gpt-4.1-mini",
  orchestratorEnabled: true,
  orchestratorMcpServerIds: [],
  orchestratorConnectorIds: [],
  orchestratorHttpToolCollectionIds: [],
  httpToolApprovalPost: true,
  httpToolApprovalPutPatch: true,
  httpToolApprovalDelete: true,
  toolApprovalDisplay: "modal",
  voiceTranscriptionModel: "whisper-1",
  voiceOutputEnabled: true,
  soundFxEnabled: true,
  voiceTtsModel: "gpt-4o-mini-tts",
  locationEnabled: false,
  remoteImagesAutoLoad: false,
  bgMusicEnabled: false,
  voiceTtsVoice: "alloy",
  agentRunTimeoutSeconds: 3600,
  chatHistoryMessageLimit: 20,
  bgMusicVolume: 0.1,
  systemStatsPollIntervalMs: 3000,
  soundVariantSend: 1,
  soundVariantReceive: 1,
  soundVariantHandoff: 1,
  soundVariantComplete: 1,
  soundVariantStartup: 1,
  soundVariantAgentCreated: 1,
  soundVariantAgentDeleted: 1,
  soundVariantConsult: 1,
  chatVisibleConversations: 1,
};

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMA, key);
}

/** Why a value was refused, phrased for a human — it reaches ConfigAgent's tool error, which
 * the model relays to the user. */
export type ValidationFailure = { key: string; reason: string };

function describe(kind: SettingKind): string {
  switch (kind.type) {
    case "string": {
      const limits = [
        kind.nonEmpty ? "not be empty" : null,
        kind.maxLength ? `be ${kind.maxLength} characters or fewer` : null,
        kind.singleLine ? "be a single line" : null,
      ].filter(Boolean);
      return limits.length > 0 ? limits.join(", and ") : "a string";
    }
    case "model":
      return 'look like a model id ("model" or "provider/model")';
    case "url":
      return "be an http:// or https:// URL";
    case "boolean":
      return "true or false";
    case "stringArray":
      return "an array of strings";
    case "enum":
      return `one of: ${kind.values.join(", ")}`;
    case "number": {
      const bounds =
        kind.min !== undefined && kind.max !== undefined ? ` between ${kind.min} and ${kind.max}` : "";
      return `${kind.integer ? "a whole number" : "a number"}${bounds}`;
    }
  }
}

/**
 * Checks one value against its key's declared shape, returning the value to persist or a
 * reason it was refused.
 *
 * Strings are trimmed, because every string setting here is a name, URL, model id or prompt —
 * none of them wants leading whitespace, and a value that differs from the same value with a
 * stray space is a support question nobody enjoys. Empty strings stay legal: "" is how the app
 * says "unset" for API keys and for orchestratorPromptOverride ("use the built-in prompt").
 */
export function validateSettingValue(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; reason: string } {
  if (!isSettingKey(key)) return { ok: false, reason: "not a known setting" };
  const kind: SettingKind = SETTINGS_SCHEMA[key];

  switch (kind.type) {
    case "string": {
      if (typeof value !== "string") return { ok: false, reason: "must be a string" };
      const trimmed = value.trim();
      if (kind.nonEmpty && trimmed.length === 0) return { ok: false, reason: "cannot be empty" };
      if (kind.maxLength && trimmed.length > kind.maxLength) {
        return { ok: false, reason: `must be ${kind.maxLength} characters or fewer` };
      }
      // Rejected rather than collapsed: a newline in one of these is either a mistake or an
      // attempt to make the value read as a new section of the prompt it lands in. Silently
      // rewriting it would hide both.
      if (kind.singleLine && /[\r\n]/.test(trimmed)) return { ok: false, reason: "must be a single line" };
      return { ok: true, value: trimmed };
    }

    case "model": {
      if (typeof value !== "string") return { ok: false, reason: "must be a string" };
      const trimmed = value.trim();
      // Empty clears the field back to its default; the read side substitutes one.
      if (trimmed.length === 0) return { ok: true, value: "" };
      return MODEL_ID_PATTERN.test(trimmed)
        ? { ok: true, value: trimmed }
        : { ok: false, reason: `must ${describe(kind)}` };
    }

    case "url": {
      if (typeof value !== "string") return { ok: false, reason: "must be a string" };
      const trimmed = value.trim();
      // Empty is how the app says "unset"; provider.ts substitutes OpenAI's base URL.
      if (trimmed.length === 0) return { ok: true, value: "" };
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        return { ok: false, reason: `must ${describe(kind)}` };
      }
      // Parsing via `new URL` rather than a regex, for the reason security/externalUrl.ts gives:
      // it normalises the scheme, so a leading tab or newline cannot smuggle one past a
      // `^https?:` test. Anything that is not a page URL is refused outright — the API key is
      // sent to whatever is configured here, so `ftp:`, `file:` and `javascript:` have no
      // business being accepted, and before this they were stored verbatim.
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, reason: `must ${describe(kind)}` };
      }
      return { ok: true, value: trimmed };
    }

    case "boolean":
      return typeof value === "boolean" ? { ok: true, value } : { ok: false, reason: "must be true or false" };

    case "stringArray":
      return Array.isArray(value) && value.every((entry) => typeof entry === "string")
        ? { ok: true, value }
        : { ok: false, reason: "must be an array of strings" };

    case "enum":
      return typeof value === "string" && kind.values.includes(value)
        ? { ok: true, value }
        : { ok: false, reason: `must be ${describe(kind)}` };

    case "number": {
      // Number.isFinite rather than !isNaN: Infinity is not NaN but is useless as a timeout,
      // a row limit or a poll interval.
      if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, reason: "must be a number" };
      if (kind.integer && !Number.isInteger(value)) return { ok: false, reason: "must be a whole number" };
      if (kind.min !== undefined && value < kind.min) return { ok: false, reason: `must be ${describe(kind)}` };
      if (kind.max !== undefined && value > kind.max) return { ok: false, reason: `must be ${describe(kind)}` };
      return { ok: true, value };
    }
  }
}

/**
 * Splits a patch into the entries safe to persist and the ones refused.
 *
 * Refusing per key rather than rejecting the whole patch: a Settings screen sends one field at
 * a time, and a bulk write that fails entirely because of one bad entry would lose good edits
 * alongside the bad one.
 */
export function validateSettingsPatch(patch: Record<string, unknown>): {
  accepted: Record<string, unknown>;
  rejected: ValidationFailure[];
} {
  const accepted: Record<string, unknown> = {};
  const rejected: ValidationFailure[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const result = validateSettingValue(key, value);
    if (result.ok) accepted[key] = result.value;
    else rejected.push({ key, reason: result.reason });
  }
  return { accepted, rejected };
}
