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

/** Hosts that code outside the registry also needs to name — the legacy Chat slot falls back to
 * OpenAI's, and the cost lookup in ai/provider.ts only applies to OpenRouter. Exported from here
 * so there is one literal per host rather than a copy that can drift out of step with the entry
 * below it. */
export const OPENAI_BASE_URL = "https://api.openai.com/v1";
export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** Listed in the order the onboarding chips and the Settings dropdown show them. */
export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: OPENROUTER_BASE_URL,
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
    baseUrl: OPENAI_BASE_URL,
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

/**
 * Which provider a bare base URL belongs to.
 *
 * Needed because `chatProviderId` is `""` on an install that predates the registry, while the
 * legacy `chatApiUrl` still says where it was pointed. Settings has to show *something* selected
 * rather than an empty dropdown, and this is the same prefix match the providers migration used
 * to seed those installs — deliberately, so the UI agrees with what the database did.
 *
 * An empty URL is OpenAI, because that is what an empty chatApiUrl has always meant at runtime.
 * Anything unrecognised is a custom OpenAI-compatible host, which is what `local` is for.
 */
export function inferProviderId(url: string): string {
  const trimmed = url.trim();
  if (trimmed === "") return DEFAULT_PROVIDER_ID;
  const hosted = AI_PROVIDERS.find((provider) => provider.baseUrl !== "" && trimmed.startsWith(provider.baseUrl));
  return hosted?.id ?? "local";
}

/** The providers that can back the Voice slot. Separate from the full list because Voice needs
 * `/audio/*`, which only OpenAI serves. */
export function voiceProviders(): AiProvider[] {
  return AI_PROVIDERS.filter((provider) => provider.supportsVoice);
}

/**
 * Which provider a model id unmistakably belongs to, or null when nothing about it says.
 *
 * Only three shapes are unmistakable, and each is a *naming scheme* rather than a catalogue
 * entry, so none of them goes stale when a provider ships a new model.
 */
function obviousProviderFor(model: string): string | null {
  if (model.startsWith("claude-")) return "anthropic";
  // OpenRouter namespaces everything as `vendor/model`, optionally behind its `~latest` marker.
  if (model.includes("/") || model.startsWith("~")) return "openrouter";
  if (/^(gpt-|chatgpt-|o\d)/.test(model)) return "openai";
  return null;
}

/**
 * Whether a model id looks like one the given provider actually serves.
 *
 * Advisory only — it drives a warning, never a refused write. It exists because switching an
 * agent to a provider with no `defaultChatModel` leaves the old provider's id in place, and an
 * agent reading "Claude" while still naming `gpt-4.1-mini` looks configured and 404s on first use.
 *
 * Framed as "does this obviously belong to someone *else*", not "is this on an allowlist for the
 * chosen provider". The allowlist version is the tempting one and it is wrong: a false warning
 * tells someone their working setup is broken, which is far more expensive than a missed one, and
 * an allowlist manufactures those in bulk. Pointing the `openai` slot at an OpenAI-compatible
 * gateway is a supported setup — that is what its editable URL is for — so `llama-3.3-70b-instruct`
 * or an Azure-style deployment name under `openai` has to pass, as do bare `o1`/`o3` and every
 * embedding, image and moderation id that will ship after this is written.
 *
 * So it stays quiet unless the id carries another provider's naming scheme, and quiet always for
 * a blank id (that means "use the default"), an agent following the Chat slot, an unrecognised
 * provider (which has its own warning), and `local`, where the user names their own models.
 */
export function modelBelongsToProvider(providerId: string, modelId: string): boolean {
  const model = modelId.trim().toLowerCase();
  if (model === "" || providerId === "" || providerId === "local" || !findProvider(providerId)) return true;

  const obvious = obviousProviderFor(model);
  return obvious === null || obvious === providerId;
}
