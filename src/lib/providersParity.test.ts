import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, DEFAULT_PROVIDER_ID, findProvider, inferProviderId, voiceProviders } from "./providers";
import { AI_PROVIDERS as MAIN_AI_PROVIDERS } from "../../electron/main/ai/providers";
import { MODEL_ID_PATTERN } from "../../electron/main/settingsSchema";

/**
 * The renderer and the main process each hold their own copy of the provider registry, because
 * `electron/` and `src/` are separate TypeScript projects and tsconfig.web.json deliberately
 * keeps renderer code from importing main's. Two copies of the same facts drift — that is
 * exactly what happened to the settings defaults (finding S1), where a toggle read "on" in the
 * UI while main's own view of it was "off".
 *
 * This test is the thing that stops it here. It lives on the renderer side because that is where
 * both are reachable.
 */
describe("provider registry, renderer vs main", () => {
  it("is identical on both sides", () => {
    expect(MAIN_AI_PROVIDERS).toEqual(AI_PROVIDERS);
  });

  it("lists the same ids in the same order", () => {
    // Order is not cosmetic: it is the order the onboarding chips and the Settings dropdown
    // render in, so a reorder on one side alone would silently change the UI on that side only.
    expect(MAIN_AI_PROVIDERS.map((p) => p.id)).toEqual(AI_PROVIDERS.map((p) => p.id));
  });

  it("offers exactly the four providers the app supports", () => {
    expect(AI_PROVIDERS.map((p) => p.id)).toEqual(["openrouter", "openai", "anthropic", "local"]);
  });
});

/**
 * These are measured facts, not preferences — each was probed against the live API before being
 * written down (see 0-cowork/plans/active/ai-providers-keys-models.md). They are pinned
 * individually so that changing one fails with an obvious message rather than a diff of four
 * objects, and so a future edit made on a hunch has to argue with a recorded observation.
 */
describe("the capability facts each provider was measured against", () => {
  it("routes Claude and Local AI through chat completions, and the rest through responses", () => {
    // Anthropic's OpenAI-compatible surface 404s on POST /responses; Ollama has no such endpoint
    // either. OpenAI and OpenRouter both answer 200 there, which is why this is per-provider
    // rather than a global setOpenAIAPI('chat_completions') switch.
    expect(findProvider("anthropic")?.api).toBe("chat_completions");
    expect(findProvider("local")?.api).toBe("chat_completions");
    expect(findProvider("openai")?.api).toBe("responses");
    expect(findProvider("openrouter")?.api).toBe("responses");
  });

  it("knows Anthropic's model listing refuses a bearer token", () => {
    // GET https://api.anthropic.com/v1/models with `Authorization: Bearer` returns 401 "Invalid
    // bearer token"; it wants `x-api-key` plus `anthropic-version`. Chat traffic is unaffected —
    // the compat layer accepts bearer there, which is what the OpenAI SDK client sends — so this
    // flag exists purely for the Settings connectivity check.
    expect(findProvider("anthropic")?.modelsAuth).toBe("anthropic");
    for (const id of ["openai", "openrouter", "local"]) {
      expect(findProvider(id)?.modelsAuth, id).toBe("bearer");
    }
  });

  it("offers voice only where /audio/* actually exists", () => {
    // If this ever lists more than OpenAI, the Voice slot will offer a provider that 404s at the
    // first transcription — which surfaces as a broken mic, not as a settings error.
    expect(voiceProviders().map((p) => p.id)).toEqual(["openai"]);
  });

  it("requires a key everywhere except the local server", () => {
    expect(findProvider("local")?.keyRequired).toBe(false);
    for (const id of ["openai", "openrouter", "anthropic"]) {
      expect(findProvider(id)?.keyRequired, id).toBe(true);
    }
  });

  it("leaves the local server's URL blank, and fills every hosted one in", () => {
    // Blank here has to mean "you must supply one" rather than the "fall back to OpenAI" that an
    // empty chatApiUrl means in ai/provider.ts — only the user knows a self-hosted address.
    expect(findProvider("local")?.baseUrl).toBe("");
    for (const id of ["openai", "openrouter", "anthropic"]) {
      expect(findProvider(id)?.baseUrl, id).toMatch(/^https:\/\//);
    }
  });
});

describe("every default model the registry ships", () => {
  it("passes the write boundary's own validation", () => {
    // The invariant that matters, and the one that was broken on the first attempt: a default
    // this registry prefills into the model field but `validateSettingValue` would refuse is
    // unsavable — the UI shows it, the user presses save, and the value is silently dropped with
    // only a debug.log line to show for it. Asserting the whole set catches the next one too.
    for (const provider of AI_PROVIDERS) {
      if (provider.defaultChatModel === "") continue;
      expect(MODEL_ID_PATTERN.test(provider.defaultChatModel), provider.id).toBe(true);
    }
  });

  it("accepts an Ollama name:tag id", () => {
    // Ollama's normal convention has no vendor prefix, so the tag colon lands in the first
    // segment. Restricting `:` to after a `/` made most locally-installed models unsavable —
    // found the moment a real Ollama server was available to test against.
    for (const id of ["llama3.2:3b", "qwen2.5:7b"]) {
      expect(MODEL_ID_PATTERN.test(id), id).toBe(true);
    }
  });

  it("accepts OpenRouter's tilde-prefixed floating alias", () => {
    // Named explicitly because it is the specific id that forced MODEL_ID_PATTERN to widen. The
    // `~` is OpenRouter's own syntax, not a typo: this form is listed by their /models and
    // returns 200, while the de-tilde'd form is refused as "not a valid model ID".
    expect(MODEL_ID_PATTERN.test("~deepseek/deepseek-v4-flash-latest")).toBe(true);
    expect(findProvider("openrouter")?.defaultChatModel).toBe("~deepseek/deepseek-v4-flash-latest");
  });

  it("still rejects the things a model id can never be", () => {
    // Widening the pattern must not turn it into "anything goes" — these are the shapes the
    // check exists to catch, including a tilde used anywhere but as a leading marker.
    for (const bad of ["", " ", "has space", "deep~seek/model", "~", "model/", "/model", "a/b/c"]) {
      expect(MODEL_ID_PATTERN.test(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("inferring a provider from a legacy URL", () => {
  // chatProviderId is "" on an install that predates the registry, so Settings has to derive a
  // selection from the URL alone. This must agree with the prefix match the migration used to
  // seed those same installs, or the dropdown would disagree with the database.
  it.each([
    ["", "openai"],
    ["https://api.openai.com/v1", "openai"],
    ["https://openrouter.ai/api/v1", "openrouter"],
    ["https://api.anthropic.com/v1", "anthropic"],
    ["http://localhost:11434/v1", "local"],
    ["https://some-proxy.example.com/v1", "local"],
  ])("maps %s to %s", (url, expected) => {
    expect(inferProviderId(url)).toBe(expected);
  });
});

describe("provider lookup", () => {
  it("returns null for an id this build has never heard of", () => {
    // A database can hold an id written by a build that offered a provider this one doesn't.
    // Callers fall back to the default rather than throwing, so the app still starts.
    expect(findProvider("gemini")).toBeNull();
    expect(findProvider("")).toBeNull();
  });

  it("resolves the default provider id", () => {
    expect(findProvider(DEFAULT_PROVIDER_ID)).not.toBeNull();
  });
});
