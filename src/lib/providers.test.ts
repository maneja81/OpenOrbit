import { describe, expect, it } from "vitest";
import { AI_PROVIDERS, modelBelongsToProvider } from "./providers";

/**
 * The check is advisory — it drives a warning, never a refused write — so the bar is different
 * from a validator's: a missed mismatch costs a warning nobody saw, a false one tells a user
 * their working setup is broken. These cases pin both directions.
 */
describe("modelBelongsToProvider", () => {
  describe("says nothing where a judgment would be guesswork", () => {
    it("a blank model id — that means 'use the default'", () => {
      expect(modelBelongsToProvider("anthropic", "")).toBe(true);
      expect(modelBelongsToProvider("anthropic", "   ")).toBe(true);
    });

    it("an agent following the Chat slot — there is no provider to compare against", () => {
      expect(modelBelongsToProvider("", "claude-haiku-4-5-20251001")).toBe(true);
    });

    it("an unrecognised provider — that has its own, more specific warning", () => {
      expect(modelBelongsToProvider("not-a-provider", "gpt-4.1-mini")).toBe(true);
    });

    it("a local server, where the user names their own models", () => {
      expect(modelBelongsToProvider("local", "llama3.1:8b")).toBe(true);
      expect(modelBelongsToProvider("local", "anything-at-all")).toBe(true);
    });
  });

  describe("accepts what each provider actually serves", () => {
    it("OpenRouter's namespaced ids, with or without the ~latest marker", () => {
      expect(modelBelongsToProvider("openrouter", "anthropic/claude-3.5-sonnet")).toBe(true);
      expect(modelBelongsToProvider("openrouter", "~deepseek/deepseek-v4-flash-latest")).toBe(true);
    });

    it("Anthropic's claude-* ids", () => {
      expect(modelBelongsToProvider("anthropic", "claude-haiku-4-5-20251001")).toBe(true);
    });

    it("OpenAI's chat, reasoning and audio families", () => {
      for (const model of ["gpt-4.1-mini", "chatgpt-4o-latest", "o3-mini", "whisper-1", "tts-1"]) {
        expect(modelBelongsToProvider("openai", model)).toBe(true);
      }
    });

    it("every provider's own registry default", () => {
      for (const provider of AI_PROVIDERS) {
        expect(modelBelongsToProvider(provider.id, provider.defaultChatModel)).toBe(true);
      }
    });
  });

  describe("flags the mismatch that actually happens", () => {
    // Switching an agent to a provider with no defaultChatModel leaves the previous provider's
    // id in place, so this is the exact state a user lands in.
    it("an OpenAI id pointed at Anthropic", () => {
      expect(modelBelongsToProvider("anthropic", "gpt-4.1-mini")).toBe(false);
    });

    it("a Claude id pointed at OpenAI", () => {
      expect(modelBelongsToProvider("openai", "claude-haiku-4-5-20251001")).toBe(false);
    });

    it("a bare id pointed at OpenRouter, which namespaces everything", () => {
      expect(modelBelongsToProvider("openrouter", "gpt-4.1-mini")).toBe(false);
    });

    it("regardless of case", () => {
      expect(modelBelongsToProvider("anthropic", "GPT-4.1-Mini")).toBe(false);
    });
  });
});
