/**
 * The AI providers the app knows how to talk to, and what each one can actually do.
 *
 * Renderer-side copy. Mirrors `electron/main/ai/providers.ts` exactly, for the same reason
 * DEFAULT_SETTINGS mirrors SETTING_DEFAULTS: `electron/` and `src/` are separate TypeScript
 * projects, and tsconfig.web.json deliberately keeps renderer code from importing main's. The
 * mechanism that stops the two drifting is `src/lib/providersParity.test.ts`, not this comment.
 *
 * Every field was measured against the live API rather than assumed — see
 * `0-cowork/plans/active/ai-providers-keys-models.md` for the probe results.
 */

/**
 * Which HTTP surface an agent run has to use.
 *
 * `@openai/agents` defaults to the Responses API, and the app has never called `setOpenAIAPI`,
 * so every run to date has gone to `POST /responses`. OpenAI and OpenRouter both serve that.
 * Anthropic's OpenAI-compatible surface does not — it 404s — and neither does Ollama's.
 */
export type ProviderApi = "responses" | "chat_completions";

/**
 * How the connectivity check authenticates against `GET /models`.
 *
 * `bearer` is the OpenAI convention and what the SDK client sends for chat traffic everywhere,
 * Anthropic included. But Anthropic's native `/v1/models` rejects a bearer token outright (401
 * "Invalid bearer token") and wants `x-api-key` plus `anthropic-version`.
 */
export type ProviderModelsAuth = "bearer" | "anthropic";

export interface AiProvider {
  /** Stable key. Persisted in the database, so never rename one of these. */
  id: string;
  label: string;
  /** Prefilled into the API URL field; always editable. Empty for a self-hosted server, where
   * only the user knows the address — and where empty must mean "you must supply one", not the
   * "fall back to OpenAI" that an empty chatApiUrl means today. */
  baseUrl: string;
  /** Prefilled into the model field; always editable. Empty where there is no sensible default. */
  defaultChatModel: string;
  api: ProviderApi;
  modelsAuth: ProviderModelsAuth;
  /** False only for a local server, which authenticates nothing. Making a key mandatory there
   * would block the one provider whose whole point is not having one. */
  keyRequired: boolean;
  /** Whether `/audio/transcriptions` and `/audio/speech` exist. Only OpenAI serves them, so the
   * Voice slot cannot be pointed at anything else — the field is what stops the UI offering it. */
  supportsVoice: boolean;
  defaultTranscriptionModel: string;
  defaultTtsModel: string;
}

/** Listed in the order the onboarding chips and the Settings dropdown show them. */
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    // The leading `~` is OpenRouter's own syntax for a floating "latest" alias, not a typo: the
    // id is listed by GET /models and returns 200, while the de-tilde'd form is refused as "not
    // a valid model ID". MODEL_ID_PATTERN in electron/main/settingsSchema.ts admits it for this
    // reason.
    defaultChatModel: "~deepseek/deepseek-v4-flash-latest",
    api: "responses",
    modelsAuth: "bearer",
    keyRequired: true,
    supportsVoice: false,
    defaultTranscriptionModel: "",
    defaultTtsModel: "",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultChatModel: "gpt-4.1-mini",
    api: "responses",
    modelsAuth: "bearer",
    keyRequired: true,
    supportsVoice: true,
    defaultTranscriptionModel: "whisper-1",
    defaultTtsModel: "gpt-4o-mini-tts",
  },
  {
    id: "anthropic",
    label: "Claude",
    // Anthropic's OpenAI-compatible surface. Chat and tool calls work through it with a bearer
    // token; `/responses` does not exist, hence chat_completions above.
    baseUrl: "https://api.anthropic.com/v1",
    defaultChatModel: "claude-haiku-4-5-20251001",
    api: "chat_completions",
    modelsAuth: "anthropic",
    keyRequired: true,
    supportsVoice: false,
    defaultTranscriptionModel: "",
    defaultTtsModel: "",
  },
  {
    id: "local",
    label: "Local AI",
    baseUrl: "",
    defaultChatModel: "",
    api: "chat_completions",
    modelsAuth: "bearer",
    keyRequired: false,
    supportsVoice: false,
    defaultTranscriptionModel: "",
    defaultTtsModel: "",
  },
];

export const PROVIDER_IDS = AI_PROVIDERS.map((provider) => provider.id);

/** The provider a fresh install starts on, and the fallback when a stored id is unrecognised. */
export const DEFAULT_PROVIDER_ID = "openai";

/** Looks up a provider, or null when the id is unknown — a database can hold an id written by a
 * build that offered a provider this one doesn't. Callers fall back rather than throwing. */
export function findProvider(id: string): AiProvider | null {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? null;
}

/** The providers that can back the Voice slot. Separate from the full list because Voice needs
 * `/audio/*`, which only OpenAI serves. */
export function voiceProviders(): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => provider.supportsVoice);
}
