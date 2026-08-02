import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSpeak } from "./useSpeak";

/**
 * The Voice slot is the one part of the app that cannot follow the Chat provider: only OpenAI
 * serves /audio/transcriptions and /audio/speech, so onboarding onto Claude, OpenRouter or a
 * local server leaves it unconfigured. What that must *not* do is throw on the first greeting,
 * which is exactly what a real run produced:
 *
 *   Error occurred in handler for 'voice:synthesize': No Voice API key configured.
 *   [speak] synth failed, falling back to browser TTS
 *
 * The fallback was already there; the failing round trip in front of it was not necessary.
 */
describe("useSpeak when the Voice slot has no credentials", () => {
  const synthesize = vi.fn();
  const speakFn = vi.fn();

  beforeEach(() => {
    synthesize.mockReset().mockResolvedValue({ audio: "", format: "mp3" });
    speakFn.mockReset();
    vi.stubGlobal("speechSynthesis", { speak: speakFn, cancel: vi.fn(), getVoices: () => [] });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        text: string;
        constructor(text: string) {
          this.text = text;
        }
      }
    );
    vi.stubGlobal("agentsAPI", {
      voice: { synthesize },
      dev: { log: vi.fn() },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("goes straight to the browser voice without calling the provider", () => {
    const { result } = renderHook(() => useSpeak(false));
    act(() => result.current.speak("hello"));

    // The point of the fix: no round trip that can only fail.
    expect(synthesize).not.toHaveBeenCalled();
    // Speech still happens — output degrades to the OS voice rather than going silent, which is
    // why voice *output* is left enabled while voice *input* is switched off.
    expect(speakFn).toHaveBeenCalled();
  });

  it("uses the provider once the slot is configured", () => {
    const { result } = renderHook(() => useSpeak(true));
    act(() => result.current.speak("hello"));
    expect(synthesize).toHaveBeenCalledWith("hello");
  });

  it("still says nothing when there is no text", () => {
    const { result } = renderHook(() => useSpeak(false));
    act(() => result.current.speak(""));
    expect(speakFn).not.toHaveBeenCalled();
    expect(synthesize).not.toHaveBeenCalled();
  });
});
