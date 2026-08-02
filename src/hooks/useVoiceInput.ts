import { useCallback, useRef, useState } from "react";
import { formatHumanizedError, humanizeError } from "@/lib/humanizeError";

interface UseVoiceInputOptions {
  onFinalResult: (text: string) => void;
  onUnsupported: () => void;
  onError?: (message: string) => void;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read recorded audio"));
    reader.readAsDataURL(blob);
  });
}

const MIN_CLIP_MS = 350;
// Below this peak sample amplitude (of 1.0 full-scale), a clip is treated as silence/noise
// floor rather than speech — Whisper-family models reliably hallucinate boilerplate phrases
// (e.g. "thanks for watching, please subscribe") when fed near-silent or sub-second audio,
// and those hallucinations were being sent to the orchestrator as if the user had said them.
const SILENCE_PEAK_AMPLITUDE = 0.02;

/** True if the clip is too short or too quiet to plausibly contain speech. Decodes via
 * Web Audio rather than trusting blob size/duration alone, since a short clip can still be
 * loud (a cough, a bump) and a long one can still be near-silent room tone. */
async function isLikelySilence(blob: Blob): Promise<boolean> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    if (decoded.duration * 1000 < MIN_CLIP_MS) return true;
    let peak = 0;
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    return peak < SILENCE_PEAK_AMPLITUDE;
  } finally {
    void audioCtx.close();
  }
}

/** Records audio via MediaRecorder and sends it to OpenRouter's Whisper-compatible
 * transcription endpoint. Replaces the browser's built-in SpeechRecognition — that API
 * streams audio to a Google-operated backend using an API key baked into official Chrome
 * builds, which Electron's bundled Chromium doesn't have, so it always failed with a
 * "network" error a moment after starting. */
export function useVoiceInput({ onFinalResult, onUnsupported, onError }: UseVoiceInputOptions) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const listeningRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);

  const startVoice = useCallback(async () => {
    if (listeningRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onUnsupported();
      return;
    }
    let stream: MediaStream;
    try {
      // Explicit rather than relying on browser defaults — echoCancellation in particular
      // reduces the TTS reply (played through speakers) bleeding back into the next
      // recording, which was contributing to the near-silent/noisy clips that made
      // Whisper hallucinate (see isLikelySilence above).
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (err) {
      onError?.(formatHumanizedError(humanizeError(err)));
      return;
    }
    if (listeningRef.current) {
      // stopVoice() was called while the permission prompt was pending.
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      listeningRef.current = false;
      setListening(false);

      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      chunksRef.current = [];
      if (blob.size === 0) return;
      // Skip the transcription round-trip entirely for near-silent/sub-second clips —
      // sending them to Whisper produces hallucinated boilerplate text that would
      // otherwise get treated as a real user message (see isLikelySilence above).
      if (await isLikelySilence(blob)) return;

      setTranscribing(true);
      try {
        const base64 = await blobToBase64(blob);
        const format = (recorder.mimeType || "audio/webm").split(";")[0].split("/")[1] || "webm";
        const text = (await window.agentsAPI.voice.transcribe(base64, format)).trim();
        if (text) onFinalResult(text);
      } catch (err) {
        onError?.(formatHumanizedError(humanizeError(err)));
      } finally {
        setTranscribing(false);
      }
    };

    recorder.start();
    listeningRef.current = true;
    setListening(true);
  }, [onFinalResult, onUnsupported, onError]);

  const stopVoice = useCallback(() => {
    if (!listeningRef.current) {
      // Release the mic if the user let go before getUserMedia resolved.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      return;
    }
    mediaRecorderRef.current?.stop();
  }, []);

  return { listening, transcribing, startVoice, stopVoice };
}
