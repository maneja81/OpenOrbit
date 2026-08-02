import { afterEach, describe, expect, it, vi } from "vitest";

let chatApiUrl = "";

vi.mock("../db/settingsStore", () => ({
  getSetting: vi.fn((name: string, defaultValue: unknown) =>
    name === "appSettings.chatApiUrl" && chatApiUrl ? chatApiUrl : defaultValue
  ),
  getSettingsByPrefix: vi.fn(() => ({ voiceApiKey: "encrypted-key", chatApiKey: "encrypted-key" })),
}));

vi.mock("../security/secretStorage", () => ({
  decryptSecret: vi.fn(() => "test-key"),
}));

import { transcribeAudio, estimateGenerationCost } from "./provider";

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
