import OpenAI from "openai";
import {
  OpenAIChatCompletionsModel,
  OpenAIResponsesModel,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  type Model,
} from "@openai/agents";
import { getSettingsByPrefix } from "../db/settingsStore";
import { readAppSetting } from "../appSettings";
import { decryptSecret } from "../security/secretStorage";
import { SETTING_DEFAULTS } from "../settingsSchema";
import { findProvider, type ProviderApi, type ProviderModelsAuth } from "./providers";
import { getProviderCredentials } from "../db/providersStore";
import { devLog } from "../devLog";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const NAMESPACE = "appSettings.";
/** Required by Anthropic's native endpoints; ignored by their OpenAI-compatible one. */
const ANTHROPIC_VERSION = "2023-06-01";
/** Sent as the bearer token for providers that authenticate nothing (a local Ollama server).
 * Never a credential — it exists only because the OpenAI SDK refuses to construct without one. */
const UNAUTHENTICATED_PLACEHOLDER_KEY = "no-key-required";

/** Chat and Voice are independent credential slots (Settings → AI Models) — a user can
 * point either at OpenAI (the default), OpenRouter, Ollama, or any other OpenAI-compatible
 * host without affecting the other. */
type CredentialSlot = "chat" | "voice";

function getDecryptedKey(slot: CredentialSlot): string {
  const settingKey = slot === "chat" ? "chatApiKey" : "voiceApiKey";
  const settings = getSettingsByPrefix(NAMESPACE);
  const encryptedKey = settings[settingKey];
  if (typeof encryptedKey !== "string" || encryptedKey.length === 0) {
    const label = slot === "chat" ? "Chat" : "Voice";
    throw new Error(`No ${label} API key configured. Set one in Settings → AI Models first.`);
  }
  return decryptSecret(encryptedKey);
}

/** User-configurable base URL (onboarding/Settings → AI Models); blank falls back to
 * OpenAI's, same "blank means use the default" pattern as orchestratorModel. */
function getConfiguredUrl(slot: CredentialSlot): string {
  const settingKey = slot === "chat" ? "chatApiUrl" : "voiceApiUrl";
  // One of the few places an explicit fallback is right rather than lazy: the schema default for
  // these is "" (the field is genuinely unset), but an unset URL has to resolve to OpenAI's here.
  return readAppSetting(settingKey, OPENAI_BASE_URL) || OPENAI_BASE_URL;
}

/**
 * What a slot or an agent actually needs to make a request, wherever it came from.
 *
 * `api` is the field that did not exist before providers: `@openai/agents` defaults to the
 * Responses API and the app has never called `setOpenAIAPI`, so every run to date went to
 * `POST /responses`. OpenAI and OpenRouter serve that; Anthropic's OpenAI-compatible surface
 * 404s on it and Ollama has no such endpoint, so those have to be driven through
 * `/chat/completions` instead.
 */
export interface ResolvedProvider {
  apiKey: string;
  baseUrl: string;
  api: ProviderApi;
  modelsAuth: ProviderModelsAuth;
  /** For error messages — "Claude" reads better than "anthropic" in a message a user sees. */
  label: string;
}

/**
 * Auth headers for the `GET /models` connectivity check.
 *
 * Every provider accepts a bearer token for *chat* traffic, Anthropic included — that is what the
 * OpenAI SDK client sends and it works. Their native `/v1/models` is the exception: it rejects a
 * bearer token with 401 "Invalid bearer token" and wants `x-api-key` plus `anthropic-version`.
 * Without this the Test button would report a working Claude setup as broken.
 */
function modelsAuthHeaders(resolved: ResolvedProvider): Record<string, string> {
  if (resolved.modelsAuth === "anthropic") {
    return { "x-api-key": resolved.apiKey, "anthropic-version": ANTHROPIC_VERSION };
  }
  return { Authorization: `Bearer ${resolved.apiKey}` };
}

/**
 * Resolves a credential slot, honouring the provider registry when the slot has been moved to it
 * and falling back to the legacy pair when it hasn't.
 *
 * The empty-`providerId` branch is deliberately the *old* code path verbatim, not a
 * reimplementation of it: an install that predates the registry — which is every install today —
 * must behave exactly as it did, down to the "" URL meaning OpenAI's.
 */
function resolveSlot(slot: CredentialSlot): ResolvedProvider {
  const providerId = readAppSetting(slot === "chat" ? "chatProviderId" : "voiceProviderId");
  if (providerId === "") {
    return {
      apiKey: getDecryptedKey(slot),
      baseUrl: getConfiguredUrl(slot),
      // What the SDK has always defaulted to, and what this slot has always used.
      api: "responses",
      modelsAuth: "bearer",
      label: slot === "chat" ? "Chat" : "Voice",
    };
  }
  return resolveProviderId(providerId, slot === "chat" ? "Chat" : "Voice");
}

/**
 * Resolves one provider by registry id.
 *
 * `context` names what was pointed at it — a slot ("Chat") or an agent ("the Researcher agent") —
 * so a missing key says which thing stopped working rather than only which provider is unset.
 */
function resolveProviderId(providerId: string, context: string): ResolvedProvider {
  const provider = findProvider(providerId);
  if (!provider) {
    // A database can hold an id written by a build that offered a provider this one doesn't.
    throw new Error(
      `${context} is set to an unknown provider ("${providerId}"). Pick one again in Settings → AI Models.`
    );
  }
  const credentials = getProviderCredentials(providerId);
  const baseUrl = credentials?.apiUrl || provider.baseUrl;
  if (baseUrl === "") {
    throw new Error(`No API URL configured for ${provider.label}. Set one in Settings → AI Models first.`);
  }
  // `local` is the one provider that authenticates nothing, which is what keyRequired records.
  // Sending an empty bearer token to a server that ignores it is fine; demanding a key the user
  // does not have would block the provider whose whole point is not having one.
  if (provider.keyRequired && !credentials?.apiKey) {
    throw new Error(
      `No ${provider.label} API key configured (needed by ${context}). Set one in Settings → AI Models first.`
    );
  }
  return {
    apiKey: credentials?.apiKey ?? "",
    baseUrl,
    api: provider.api,
    modelsAuth: provider.modelsAuth,
    label: provider.label,
  };
}

/** A client bound to one provider's credentials. Built per call rather than cached, for the same
 * reason configureChatClient re-reads on every run: a key or URL changed in Settings has to take
 * effect on the next agent run, not the next launch. */
function clientFor(resolved: ResolvedProvider): OpenAI {
  // The SDK throws "Missing credentials" on an empty apiKey, but a `local` provider
  // authenticates nothing and the user may legitimately have no key — that is what
  // keyRequired: false means. A placeholder satisfies the constructor; the server ignores the
  // header it produces. Without this, pointing an agent at Ollama crashes before the first
  // request is even attempted.
  return new OpenAI({ apiKey: resolved.apiKey || UNAUTHENTICATED_PLACEHOLDER_KEY, baseURL: resolved.baseUrl });
}

/**
 * The model to hand an `Agent`, for an agent row that may name its own provider.
 *
 * Returns a plain string when the row inherits the Chat slot, which is the overwhelmingly common
 * case and the one that must not change: a string makes the SDK resolve through the process-wide
 * default client that `configureChatClient` has always set, so those runs are byte-identical to
 * before providers existed.
 *
 * Only a row that explicitly names a different provider gets a `Model` instance bound to its own
 * client — and which class it gets is the whole reason `api` is tracked per provider.
 */
export function modelForAgent(row: { model?: string | null; provider_id?: string | null }): string | Model {
  const modelId = row.model?.trim() || SETTING_DEFAULTS.orchestratorModel;
  const providerId = row.provider_id?.trim() ?? "";
  if (providerId === "") return modelId;

  let resolved: ResolvedProvider;
  try {
    resolved = resolveProviderId(providerId, `the model "${modelId}"`);
  } catch (e) {
    // Degrade to the Chat slot rather than throwing.
    //
    // buildOrchestrator constructs *every* agent before the run starts, so throwing here does not
    // fail the one misconfigured agent — it fails the whole app. Observed: pinning a single
    // sub-agent to a Local AI with no URL made an unrelated orchestrator run on OpenRouter die
    // with "No API URL configured for Local AI", for a question that never involved that agent.
    //
    // Inheriting is also the honest reading of the field: provider_id is a preference, and "" has
    // always meant "use Chat". An unresolvable id is the same situation with a worse cause. This
    // is not a silent cross-provider credential leak — the Chat provider is the user's own
    // configured default, which is exactly where this agent's traffic went before they pinned it.
    devLog(
      `[providers] agent pinned to "${providerId}" is not usable (${e instanceof Error ? e.message : String(e)}) — ` +
        `falling back to the Chat provider for model "${modelId}"`
    );
    return modelId;
  }

  const client = clientFor(resolved);
  return resolved.api === "chat_completions"
    ? new OpenAIChatCompletionsModel(client, modelId)
    : new OpenAIResponsesModel(client, modelId);
}

export function getDecryptedChatApiKey(): string {
  return resolveSlot("chat").apiKey;
}

export function getConfiguredChatUrl(): string {
  return resolveSlot("chat").baseUrl;
}

/** Reads the current (decrypted) Chat API key and configures the SDK's default client to
 * use the configured provider (OpenAI by default, or any other OpenAI-compatible host the
 * user points it at, e.g. OpenRouter or a local Ollama server). Re-reads on every call
 * rather than caching, so a key/URL change via Settings takes effect on the next agent
 * run without an app restart. */
export function configureChatClient(): void {
  const resolved = resolveSlot("chat");
  // The SDK picks Responses vs Chat Completions from a module-level default, and every agent that
  // inherits the Chat slot resolves through it. Pointing Chat at Claude therefore has to move the
  // default too, or those runs would go to `/responses` on a host that 404s it. Set explicitly
  // rather than only when it differs: the value is global and sticky, so a previous run that
  // moved it would otherwise leak into this one.
  setOpenAIAPI(resolved.api);
  setDefaultOpenAIClient(clientFor(resolved));
}

/** Looks up the actual USD cost OpenRouter billed for a completed generation, keyed by the
 * response id the model call returned. OpenRouter-only endpoint — must never be called
 * against a different host (see estimateGenerationCost below, which guards this). */
async function getOpenRouterGenerationCost(generationId: string): Promise<number | null> {
  try {
    const apiKey = getDecryptedChatApiKey();
    const response = await fetch(`${getConfiguredChatUrl()}/generation?id=${encodeURIComponent(generationId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { data?: { total_cost?: number } };
    return typeof data.data?.total_cost === "number" ? data.data.total_cost : null;
  } catch {
    return null;
  }
}

// Static USD-per-million-token pricing for models we know for certain, used only when the
// Chat section isn't pointed at OpenRouter (which has a real post-hoc cost API instead —
// see getOpenRouterGenerationCost above). OpenAI has no equivalent "confirm actual billed
// cost" endpoint, so this is the standard estimate-from-published-rates approach. Deliberately
// small and conservative: an unlisted model returns null (no cost shown) rather than a
// guessed number, since a wrong number is worse than none. Source: OpenAI's published API
// pricing as of early 2026 — must be kept in sync by hand if OpenAI changes it.
const MODEL_PRICING_USD_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
};

function estimateCostFromStaticPricing(model: string, inputTokens: number, outputTokens: number): number | null {
  const pricing = MODEL_PRICING_USD_PER_MILLION_TOKENS[model];
  if (!pricing) return null;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/** Best-effort cost for a completed chat generation — the real, actually-billed figure via
 * OpenRouter's cost-lookup API when Chat is pointed there, or a static-pricing estimate for
 * a known model otherwise (e.g. the default OpenAI setup, which has no equivalent lookup
 * API). Returns null (no cost recorded) rather than a guess when neither is available —
 * must never throw and must never affect the underlying chat response. */
export async function estimateGenerationCost(
  generationId: string | null,
  model: string,
  inputTokens: number,
  outputTokens: number
): Promise<number | null> {
  if (getConfiguredChatUrl().startsWith(OPENROUTER_BASE_URL) && generationId) {
    const real = await getOpenRouterGenerationCost(generationId);
    if (real !== null) return real;
  }
  return estimateCostFromStaticPricing(model, inputTokens, outputTokens);
}

/** Lightweight connectivity check for a Settings "Test" button — hits the provider's
 * /models listing (supported by OpenAI, OpenRouter, and Ollama's OpenAI-compat surface)
 * rather than making a real chat/audio call, so it costs ~nothing and works uniformly
 * across whichever host a section is pointed at. */
async function testConnection(slot: CredentialSlot): Promise<{ ok: boolean; detail: string }> {
  try {
    const resolved = resolveSlot(slot);
    const response = await fetch(`${resolved.baseUrl}/models`, { headers: modelsAuthHeaders(resolved) });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false, detail: `${response.status} ${detail || response.statusText}` };
    }
    return { ok: true, detail: "Connected." };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export function testChatConnection(): Promise<{ ok: boolean; detail: string }> {
  return testConnection("chat");
}

export function testVoiceConnection(): Promise<{ ok: boolean; detail: string }> {
  return testConnection("voice");
}

// Whisper-family models are known to hallucinate fluent, entirely unrelated phrases
// (often in a random language) on audio with little or no actual speech — the renderer's
// own amplitude/duration guard (useVoiceInput.ts's isLikelySilence) catches near-total
// silence, but genuine ambient noise (a cough, room hum, a brief non-speech sound) has
// enough amplitude/duration to pass that check while still not being real speech. Whisper
// itself reports its own confidence per segment when asked for verbose_json — this is
// the standard mitigation (OpenAI's own cookbook recommends the same no_speech_prob /
// avg_logprob combination) and catches hallucinations the client-side heuristic can't.
const NO_SPEECH_PROB_THRESHOLD = 0.6;
const AVG_LOGPROB_THRESHOLD = -1;

interface WhisperSegment {
  avg_logprob?: number;
  no_speech_prob?: number;
}

/** Transcribes a short audio clip via the Voice section's OpenAI-compatible
 * /audio/transcriptions endpoint. Sent as multipart/form-data with the audio as a "file"
 * field — the actual shape OpenAI's endpoint requires (a JSON + base64 body, tried
 * previously, only worked as an OpenRouter-specific convenience and 400s against real
 * OpenAI with "Field required: body.file"). Multipart is also what OpenRouter's own
 * OpenAI-compatible surface accepts, so this works unchanged for either default. */
export async function transcribeAudio(base64Audio: string, format: string): Promise<string> {
  const voice = resolveSlot("voice");
  const model = readAppSetting("voiceTranscriptionModel");

  const audioBuffer = Buffer.from(base64Audio, "base64");
  const formData = new FormData();
  formData.append("model", model);
  formData.append("file", new Blob([audioBuffer]), `audio.${format}`);
  // verbose_json is what surfaces per-segment confidence below — a provider that doesn't
  // support it (rather than 400ing) just won't include `segments`, which the check below
  // already treats as "nothing to filter on" and falls through to the plain text result.
  formData.append("response_format", "verbose_json");

  const response = await fetch(`${voice.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${voice.apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Transcription failed (${response.status}): ${detail || response.statusText}`);
  }

  const data = (await response.json()) as { text?: string; segments?: WhisperSegment[] };
  const segments = data.segments ?? [];
  if (segments.length > 0) {
    const allLikelyHallucinated = segments.every(
      (s) => (s.no_speech_prob ?? 0) > NO_SPEECH_PROB_THRESHOLD && (s.avg_logprob ?? 0) < AVG_LOGPROB_THRESHOLD
    );
    if (allLikelyHallucinated) return "";
  }
  return data.text ?? "";
}

/** Synthesizes speech from text via the Voice section's OpenAI-compatible /audio/speech
 * endpoint. Returns base64-encoded audio (mp3) plus its format, since raw bytes don't
 * cross the contextBridge/IPC boundary as cleanly as a string. If this call fails,
 * useSpeak (renderer) falls back to the browser's speechSynthesis rather than going silent. */
export async function synthesizeSpeech(text: string): Promise<{ audio: string; format: string }> {
  const voice = resolveSlot("voice");
  const model = readAppSetting("voiceTtsModel");
  const format = "mp3";

  const response = await fetch(`${voice.baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${voice.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: text,
      voice: readAppSetting("voiceTtsVoice"),
      response_format: format,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech synthesis failed (${response.status}): ${detail || response.statusText}`);
  }

  // A 200 status isn't necessarily audio — some providers/proxies return an error page or
  // JSON body with a success status. Without this check, that body gets base64-encoded and
  // handed to the renderer as if it were valid mp3, where it fails silently at playback
  // (Audio.onerror) with no indication of what actually went wrong.
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("audio/")) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech synthesis returned non-audio content-type "${contentType}": ${detail.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return { audio: Buffer.from(arrayBuffer).toString("base64"), format };
}
