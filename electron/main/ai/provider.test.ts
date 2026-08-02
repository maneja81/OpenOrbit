/**
 * @vitest-environment node
 *
 * Main-process code, so Node is the faithful environment — and the vitest default of jsdom
 * actively breaks it: the OpenAI SDK refuses to construct a client in anything browser-like
 * ("It looks like you're running in a browser-like environment"), which every modelForAgent test
 * that pins a provider has to do. The alternative would be passing dangerouslyAllowBrowser in
 * clientFor, i.e. weakening a real credential-safety flag in shipping code to suit a test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let chatApiUrl = "";
/** Which provider the Chat slot is pointed at, per test. "" is a legacy install. */
let chatProviderId = "";

vi.mock("../db/settingsStore", () => ({
  getSetting: vi.fn((name: string, defaultValue: unknown) => {
    if (name === "appSettings.chatApiUrl" && chatApiUrl) return chatApiUrl;
    if (name === "appSettings.chatProviderId") return chatProviderId;
    return defaultValue;
  }),
  getSettingsByPrefix: vi.fn(() => ({ voiceApiKey: "encrypted-key", chatApiKey: "encrypted-key" })),
}));

vi.mock("../security/secretStorage", () => ({
  decryptSecret: vi.fn(() => "test-key"),
}));

/** What configureChatClient told the SDK, per test. */
const sdkCalls: { api: string[]; clients: { baseURL?: string }[] } = { api: [], clients: [] };
vi.mock("@openai/agents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@openai/agents")>();
  return {
    ...actual,
    setOpenAIAPI: (v: string) => sdkCalls.api.push(v),
    setDefaultOpenAIClient: (c: { baseURL?: string }) => sdkCalls.clients.push(c),
  };
});

/** Credentials the provider store will report, per test. */
const providerCredentials = new Map<string, { apiUrl: string; apiKey: string }>();
vi.mock("../db/providersStore", () => ({
  getProviderCredentials: (id: string) => providerCredentials.get(id) ?? null,
}));

import { OpenAIChatCompletionsModel, OpenAIResponsesModel } from "@openai/agents";
import { AI_PROVIDERS } from "./providers";
import {
  MODEL_PRICING_USD_PER_MILLION_TOKENS,
  transcribeAudio,
  synthesizeSpeech,
  estimateGenerationCost,
  modelForAgent,
  providerIdForModel,
  configureChatClient,
} from "./provider";

describe("transcribeAudio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the transcribed text when segments look like real speech", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "what's the weather like today",
          segments: [{ avg_logprob: -0.2, no_speech_prob: 0.05 }],
        }),
      })
    );
    const text = await transcribeAudio("base64audio", "webm");
    expect(text).toBe("what's the weather like today");
  });

  it("suppresses the result when every segment looks like a no-speech hallucination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "감사합니다! 구독해주세요!",
          segments: [{ avg_logprob: -1.4, no_speech_prob: 0.92 }],
        }),
      })
    );
    const text = await transcribeAudio("base64audio", "webm");
    expect(text).toBe("");
  });

  it("keeps the text when only some segments look like hallucinations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          text: "okay sounds good",
          segments: [
            { avg_logprob: -1.4, no_speech_prob: 0.92 },
            { avg_logprob: -0.1, no_speech_prob: 0.02 },
          ],
        }),
      })
    );
    const text = await transcribeAudio("base64audio", "webm");
    expect(text).toBe("okay sounds good");
  });

  it("falls back to the plain text result when the provider returns no segments at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: "hello there" }),
      })
    );
    const text = await transcribeAudio("base64audio", "webm");
    expect(text).toBe("hello there");
  });

  it("throws with response detail on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad audio format",
      })
    );
    await expect(transcribeAudio("base64audio", "webm")).rejects.toThrow(/Transcription failed \(400\)/);
  });
});

describe("synthesizeSpeech", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns base64 audio when the provider responds with an audio content-type", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "audio/mpeg" }),
        arrayBuffer: async () => new TextEncoder().encode("fake-mp3-bytes").buffer,
      })
    );
    const result = await synthesizeSpeech("hello");
    expect(result.format).toBe("mp3");
    expect(Buffer.from(result.audio, "base64").toString()).toBe("fake-mp3-bytes");
  });

  it("throws with response detail on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        text: async () => "bad voice",
      })
    );
    await expect(synthesizeSpeech("hello")).rejects.toThrow(/Speech synthesis failed \(400\)/);
  });

  it("throws when a 200 response isn't actually audio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => '{"error":"upstream unavailable"}',
      })
    );
    await expect(synthesizeSpeech("hello")).rejects.toThrow(/non-audio content-type "application\/json"/);
  });
});

describe("estimateGenerationCost", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    chatApiUrl = "";
  });

  it("computes a static-pricing estimate for a known model when Chat isn't pointed at OpenRouter", async () => {
    chatApiUrl = "https://api.openai.com/v1";
    const cost = await estimateGenerationCost("gen-1", "gpt-4.1-mini", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.4 + 1.6, 5);
  });

  it("returns null for an unrecognized model rather than guessing", async () => {
    chatApiUrl = "https://api.openai.com/v1";
    const cost = await estimateGenerationCost("gen-1", "some/unknown-model", 1000, 1000);
    expect(cost).toBeNull();
  });

  it("uses OpenRouter's real billed cost when Chat is pointed at OpenRouter", async () => {
    chatApiUrl = "https://openrouter.ai/api/v1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { total_cost: 0.0042 } }) })
    );
    const cost = await estimateGenerationCost("gen-1", "gpt-4.1-mini", 1000, 1000);
    expect(cost).toBe(0.0042);
  });

  it("falls back to static pricing when the OpenRouter lookup itself fails", async () => {
    chatApiUrl = "https://openrouter.ai/api/v1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const cost = await estimateGenerationCost("gen-1", "gpt-4.1-mini", 1_000_000, 0);
    expect(cost).toBeCloseTo(0.4, 5);
  });
});

describe("modelForAgent", () => {
  beforeEach(() => {
    providerCredentials.clear();
  });

  describe("an agent that inherits the Chat slot", () => {
    it("gets a plain model id, not a Model instance", () => {
      // This is the path every existing agent takes, and the reason it must stay a string: a
      // string resolves through the process-wide default client configureChatClient has always
      // set, so these runs are byte-identical to before providers existed. Returning a Model here
      // would silently re-route every agent in the app.
      expect(modelForAgent({ model: "gpt-4.1-mini", provider_id: "" })).toBe("gpt-4.1-mini");
    });

    it("falls back to the default model when the row has none", () => {
      expect(modelForAgent({ model: "", provider_id: "" })).toBe("gpt-4.1-mini");
      expect(modelForAgent({ model: null, provider_id: null })).toBe("gpt-4.1-mini");
    });

    it("does not consult the provider store at all", () => {
      // No credentials registered, and yet no throw — an inherited agent must never depend on a
      // providers row existing.
      expect(() => modelForAgent({ model: "gpt-4.1-mini", provider_id: "" })).not.toThrow();
    });
  });

  describe("an agent pinned to its own provider", () => {
    it("drives Claude through Chat Completions", () => {
      providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
      const model = modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" });
      // The measured fact this whole design rests on: Anthropic's compat surface 404s /responses.
      expect(model).toBeInstanceOf(OpenAIChatCompletionsModel);
    });

    it("drives a local server through Chat Completions too", () => {
      providerCredentials.set("local", { apiUrl: "http://localhost:11434/v1", apiKey: "" });
      expect(modelForAgent({ model: "llama3.2", provider_id: "local" })).toBeInstanceOf(OpenAIChatCompletionsModel);
    });

    it.each(["openai", "openrouter"])("keeps %s on the Responses API", (id) => {
      providerCredentials.set(id, { apiUrl: "https://example.test/v1", apiKey: "sk-x" });
      // Not switched to Chat Completions just because another provider needed it — that would
      // change the request surface for existing users to buy nothing.
      expect(modelForAgent({ model: "some-model", provider_id: id })).toBeInstanceOf(OpenAIResponsesModel);
    });

    it("uses the provider's own base URL when no override is stored", () => {
      providerCredentials.set("anthropic", { apiUrl: "", apiKey: "sk-ant" });
      expect(() => modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" })).not.toThrow();
    });
  });

  describe("when a pinned provider is not usable", () => {
    // buildOrchestrator constructs *every* agent before a run starts, so throwing here does not
    // fail one agent — it fails the whole app. This was observed for real: pinning a single
    // sub-agent to a Local AI with no URL killed an unrelated orchestrator run on OpenRouter,
    // for a question that never touched that agent. Degrading to the Chat slot is the fix, and
    // these tests are what keep it from regressing to a throw.
    it("falls back to the Chat slot when the provider has no key", () => {
      expect(modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" })).toBe(
        "claude-haiku-4-5-20251001"
      );
    });

    it("falls back when the provider id is one this build has never heard of", () => {
      expect(modelForAgent({ model: "m", provider_id: "gemini" })).toBe("m");
    });

    it("falls back when a local server has no URL", () => {
      providerCredentials.set("local", { apiUrl: "", apiKey: "" });
      // Only the user knows a self-hosted address, so blank cannot silently mean OpenAI's the way
      // an empty chatApiUrl does — but it must not take the app down either.
      expect(modelForAgent({ model: "llama3.2", provider_id: "local" })).toBe("llama3.2");
    });

    it("does not demand a key from the one provider that has none", () => {
      providerCredentials.set("local", { apiUrl: "http://localhost:11434/v1", apiKey: "" });
      // keyRequired: false is the whole point of `local`. This must resolve to a real Model, not
      // fall back — falling back here would mean a configured Ollama silently ran on OpenAI.
      expect(modelForAgent({ model: "llama3.2", provider_id: "local" })).toBeInstanceOf(OpenAIChatCompletionsModel);
    });

    it("never borrows another provider's credentials", () => {
      providerCredentials.set("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-openai" });
      // Falling back to the *Chat slot* is fine — that is the user's own configured default, and
      // where this agent's traffic went before it was pinned. Building an anthropic client out of
      // OpenAI's key would not be: it would send a key to a host the user never chose for it.
      const model = modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" });
      expect(model).not.toBeInstanceOf(OpenAIChatCompletionsModel);
      expect(model).not.toBeInstanceOf(OpenAIResponsesModel);
    });
  });
});

describe("configureChatClient", () => {
  beforeEach(() => {
    providerCredentials.clear();
    sdkCalls.api.length = 0;
    sdkCalls.clients.length = 0;
    chatProviderId = "";
  });

  it("keeps a legacy install on the Responses API", () => {
    // No provider selected: the slot reads the old chatApiKey/chatApiUrl pair and must behave
    // exactly as it did before the registry existed.
    configureChatClient();
    expect(sdkCalls.api).toEqual(["responses"]);
  });

  it("moves the SDK to Chat Completions when Chat is pointed at Claude", () => {
    // This is the single line that makes Claude work at all. Agents that inherit the Chat slot
    // resolve through the SDK's module-level default, so without this they go to /responses on a
    // host that 404s it — and the failure looks like a broken app, not a misconfiguration.
    chatProviderId = "anthropic";
    providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    configureChatClient();
    expect(sdkCalls.api).toEqual(["chat_completions"]);
  });

  it("sets the API mode every time rather than only on a change", () => {
    // The value is global and sticky. A run that moved it to chat_completions would otherwise
    // leak into the next run on a Responses provider.
    chatProviderId = "anthropic";
    providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    configureChatClient();
    chatProviderId = "openai";
    providerCredentials.set("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-oai" });
    configureChatClient();
    expect(sdkCalls.api).toEqual(["chat_completions", "responses"]);
  });

  it("points the default client at the selected provider's host", () => {
    chatProviderId = "openrouter";
    providerCredentials.set("openrouter", { apiUrl: "https://openrouter.ai/api/v1", apiKey: "sk-or" });
    configureChatClient();
    expect(sdkCalls.clients.at(-1)?.baseURL).toBe("https://openrouter.ai/api/v1");
  });
});

describe("the shipped defaults are all priceable", () => {
  it("has a static price for every default this app chooses for people", () => {
    // The scope rule for MODEL_PRICING_USD_PER_MILLION_TOKENS: only models we ship as a provider
    // default belong in it, and every one of them must be there. Adding a provider without a
    // price would silently ship a default whose per-message cost never appears — which is how
    // Claude shipped in this very branch before this test existed.
    //
    // Two providers are exempt, for opposite reasons: OpenRouter reports the real billed figure
    // from its own API so a static guess would be strictly worse, and a local server is free.
    const needsStaticPrice = AI_PROVIDERS.filter(
      (provider) => provider.defaultChatModel !== "" && provider.id !== "openrouter" && provider.id !== "local"
    );
    expect(needsStaticPrice.length).toBeGreaterThan(0);
    for (const provider of needsStaticPrice) {
      expect(MODEL_PRICING_USD_PER_MILLION_TOKENS[provider.defaultChatModel], provider.id).toBeDefined();
    }
  });

  it("prices only what it can defend, not every model it has heard of", () => {
    // Deliberately small. Each entry is hand-maintained and will drift, so the table earns its
    // keep by staying at the defaults rather than becoming a half-remembered price list.
    expect(Object.keys(MODEL_PRICING_USD_PER_MILLION_TOKENS).length).toBeLessThanOrEqual(4);
  });
});

describe("a pinned agent's model still reports its id", () => {
  // ipc/agent.ts records String(agent.model) into token_usage.model and prices by that id. The
  // SDK's model classes keep the id private and do not override toString(), so a pinned agent
  // wrote "[object Object]" and lost its cost with it — both seen in a real run.
  it("stringifies to the model id, not [object Object]", () => {
    providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    const model = modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" });
    expect(String(model)).toBe("claude-haiku-4-5-20251001");
  });

  it("does the same for a Responses-API provider", () => {
    providerCredentials.set("openai", { apiUrl: "https://api.openai.com/v1", apiKey: "sk-x" });
    expect(String(modelForAgent({ model: "gpt-4.1-mini", provider_id: "openai" }))).toBe("gpt-4.1-mini");
  });

  it("leaves the inherited case alone, which was always a plain string", () => {
    expect(String(modelForAgent({ model: "gpt-4.1-mini", provider_id: "" }))).toBe("gpt-4.1-mini");
  });
});

describe("attributing cost to the provider that served the call", () => {
  beforeEach(() => {
    providerCredentials.clear();
    chatProviderId = "";
  });

  it("reads a pinned agent's provider off its model", () => {
    providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    const model = modelForAgent({ model: "claude-haiku-4-5-20251001", provider_id: "anthropic" });
    expect(providerIdForModel(model)).toBe("anthropic");
  });

  it("falls back to the Chat slot for an agent that inherits it", () => {
    chatProviderId = "local";
    // A plain string is what an inheriting agent carries, and the Chat slot is what it runs on.
    expect(providerIdForModel("gpt-4.1-mini")).toBe("local");
  });

  it("does not report a Claude-pinned agent as free just because Chat is local", async () => {
    chatProviderId = "local";
    providerCredentials.set("anthropic", { apiUrl: "https://api.anthropic.com/v1", apiKey: "sk-ant" });
    // The exact bug this parameter exists for: seen in a real run as cost_usd 0 on a Claude call.
    const cost = await estimateGenerationCost(null, "claude-haiku-4-5-20251001", 1_000_000, 1_000_000, "anthropic");
    expect(cost).toBeCloseTo(6.0, 5);
  });

  it("still reports a genuinely local call as free", async () => {
    expect(await estimateGenerationCost(null, "llama3.2:3b", 1_000_000, 1_000_000, "local")).toBe(0);
  });

  it("returns null rather than a guess for an unpriced model", async () => {
    expect(await estimateGenerationCost(null, "some/unknown-model", 1000, 1000, "openai")).toBeNull();
  });
});
