import { useCallback, useRef, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

interface SpeakCallbacks {
  onStart?: () => void;
  onEnd?: () => void;
}

// Mirrors into userData/debug.log (via the main process) in addition to the browser
// console — see electron/main/devLog.ts. Without this, a synthesis failure (bad Voice
// API key, wrong voiceApiUrl for the provider, unsupported model) falls back to browser
// speechSynthesis with zero trace, which reads as "the voice setting doesn't do anything."
function devLog(...args: unknown[]): void {
  console.log(...args);
  if (hasAgentsAPI()) window.agentsAPI.dev.log(...args);
}

/** Speaks replies via the configured AI TTS model (OpenRouter /audio/speech, see
 * synthesizeSpeech in electron/main/ai/provider.ts), falling back to the browser's
 * speechSynthesis if synthesis is unavailable or the request fails — mirrors the
 * "never break the underlying response" pattern used elsewhere for AI-provider calls.
 * Exposes `speaking` (for simple UI gating) and per-call onStart/onEnd callbacks (for
 * callers that need to react to playback transitions, e.g. pushing a status-feed step)
 * without doing so from a render-time effect. */
export function useSpeak() {
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const speakWithBrowserTts = useCallback((text: string, callbacks?: SpeakCallbacks) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onstart = () => {
      setSpeaking(true);
      callbacks?.onStart?.();
    };
    utterance.onend = () => {
      setSpeaking(false);
      callbacks?.onEnd?.();
    };
    utterance.onerror = () => {
      setSpeaking(false);
      callbacks?.onEnd?.();
    };
    window.speechSynthesis.speak(utterance);
  }, []);

  const speak = useCallback(
    (text: string, callbacks?: SpeakCallbacks) => {
      if (!text) return;

      audioRef.current?.pause();
      audioRef.current = null;
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();

      if (!hasAgentsAPI()) {
        speakWithBrowserTts(text, callbacks);
        return;
      }

      window.agentsAPI.voice
        .synthesize(text)
        .then(({ audio, format }) => {
          const el = new Audio(`data:audio/${format};base64,${audio}`);
          audioRef.current = el;
          el.onplay = () => {
            setSpeaking(true);
            callbacks?.onStart?.();
          };
          el.onended = () => {
            setSpeaking(false);
            callbacks?.onEnd?.();
          };
          el.onerror = () => {
            setSpeaking(false);
            audioRef.current = null;
            const mediaError = el.error;
            devLog(
              "[speak] audio playback failed, falling back to browser TTS",
              `code=${mediaError?.code ?? "unknown"}`,
              mediaError?.message || "(no message)"
            );
            speakWithBrowserTts(text, callbacks);
          };
          void el.play();
        })
        .catch((error: unknown) => {
          devLog("[speak] synth failed, falling back to browser TTS", error instanceof Error ? error.message : String(error));
          speakWithBrowserTts(text, callbacks);
        });
    },
    [speakWithBrowserTts]
  );

  /** Force-stops whichever playback is active (provider audio or browser TTS fallback)
   * without invoking onEnd — callers that need cleanup on manual stop (e.g. an Esc
   * keypress) should do so themselves rather than relying on the natural onend path. */
  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  return { speak, speaking, stop };
}
