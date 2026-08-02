import OpenAI from "openai";
import { setDefaultOpenAIClient } from "@openai/agents";
import { getSettingsByPrefix } from "../db/settingsStore";
import { readAppSetting } from "../appSettings";
import { decryptSecret } from "../security/secretStorage";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const NAMESPACE = "appSettings.";

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

export function getDecryptedChatApiKey(): string {
  return getDecryptedKey("chat");
}

export function getConfiguredChatUrl(): string {
  return getConfiguredUrl("chat");
}

/** Reads the current (decrypted) Chat API key and configures the SDK's default client to
 * use the configured provider (OpenAI by default, or any other OpenAI-compatible host the
 * user points it at, e.g. OpenRouter or a local Ollama server). Re-reads on every call
 * rather than caching, so a key/URL change via Settings takes effect on the next agent
 * run without an app restart. */
export function configureChatClient(): void {
  const apiKey = getDecryptedChatApiKey();
  setDefaultOpenAIClient(new OpenAI({ apiKey, baseURL: getConfiguredChatUrl() }));
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
    const apiKey = getDecryptedKey(slot);
    const baseUrl = getConfiguredUrl(slot);
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
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
  const apiKey = getDecryptedKey("voice");
  const model = readAppSetting("voiceTranscriptionModel");

  const audioBuffer = Buffer.from(base64Audio, "base64");
  const formData = new FormData();
  formData.append("model", model);
  formData.append("file", new Blob([audioBuffer]), `audio.${format}`);
  // verbose_json is what surfaces per-segment confidence below — a provider that doesn't
  // support it (rather than 400ing) just won't include `segments`, which the check below
  // already treats as "nothing to filter on" and falls through to the plain text result.
  formData.append("response_format", "verbose_json");

  const response = await fetch(`${getConfiguredUrl("voice")}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
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
  const apiKey = getDecryptedKey("voice");
  const model = readAppSetting("voiceTtsModel");
  const format = "mp3";

  const response = await fetch(`${getConfiguredUrl("voice")}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
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
