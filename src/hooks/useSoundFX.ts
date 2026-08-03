import { useCallback, useRef } from "react";

export type SoundFxEvent =
  | "send"
  | "receive"
  | "handoff"
  | "complete"
  | "startup"
  | "agentCreated"
  | "agentDeleted";

// Document-relative, not "/audio/…": built renderers load over file://, where a
// root-absolute path resolves to file:///audio/… and the clip never loads.
const STARTUP_SOUND_SRC = "./audio/start-sound.mp3";

/** Path to a pre-rendered SFX variant (see public/audio/sfx/ — 5 variations per event,
 * generated to mirror the TONES/SCIFI_TONES synthesis below at different pitches/waveforms).
 * Exported so Settings → App Sounds can preview the exact clip a variant will play. */
export function sfxSrc(event: SoundFxEvent, variant: number): string {
  return `./audio/sfx/${event}/v${variant}.wav`;
}

/** The source useSoundFX actually plays for a given event/variant — "startup" v1 is the
 * original recorded clip rather than a generated one (see useSoundFX below). */
export function sfxPreviewSrc(event: SoundFxEvent, variant: number): string {
  if (event === "startup" && variant === 1) return STARTUP_SOUND_SRC;
  return sfxSrc(event, variant);
}

/** One AudioContext oscillator "note": start frequency (Hz), an optional end frequency to
 * sweep toward, oscillator waveform, start offset and duration (seconds). */
interface Tone {
  freq: number;
  sweepTo?: number;
  type: OscillatorType;
  start: number;
  duration: number;
}

const TONES: Record<"send" | "receive" | "handoff" | "complete" | "startup", Tone[]> = {
  send: [{ freq: 520, sweepTo: 1100, type: "square", start: 0, duration: 0.07 }],
  receive: [
    { freq: 1200, sweepTo: 700, type: "square", start: 0, duration: 0.08 },
    { freq: 900, sweepTo: 1400, type: "square", start: 0.08, duration: 0.1 },
  ],
  handoff: [{ freq: 300, sweepTo: 620, type: "sawtooth", start: 0, duration: 0.09 }],
  complete: [
    { freq: 440, sweepTo: 880, type: "sawtooth", start: 0, duration: 0.14 },
    { freq: 880, sweepTo: 1320, type: "square", start: 0.12, duration: 0.16 },
  ],
  startup: [
    { freq: 220, sweepTo: 660, type: "sawtooth", start: 0, duration: 0.16 },
    { freq: 660, sweepTo: 990, type: "square", start: 0.14, duration: 0.14 },
  ],
};

/** "agentCreated"/"agentDeleted" are sci-fi noise-layered effects rather than simple
 * oscillator tones (see TONES above) — each is up to three layers scheduled on the same
 * timeline:
 * - noiseSweep: filtered white noise sweeping across a frequency range — the "energy/zap"
 *   texture a pure oscillator can't produce.
 * - shimmer (optional): a sine sweep layered under the noise for a "sparkle" glint.
 * - thump (optional): a short low sine "boom" landing after the sweep. */
interface NoiseSweepLayer {
  freqStart: number;
  freqEnd: number;
  duration: number;
  q: number;
  peakGain: number;
}

interface ShimmerLayer {
  freqStart: number;
  freqEnd: number;
  duration: number;
  gain: number;
  delay: number;
}

interface ThumpLayer {
  freq: number;
  duration: number;
  gain: number;
  delay: number;
}

interface SciFiVariant {
  noiseSweep: NoiseSweepLayer;
  shimmer?: ShimmerLayer;
  thump?: ThumpLayer;
}

const SCIFI_TONES: Record<"agentCreated" | "agentDeleted", SciFiVariant> = {
  // Agent created — energy resolving into being, ending on a soft landing thud.
  agentCreated: {
    noiseSweep: { freqStart: 600, freqEnd: 5000, duration: 0.12, q: 1.6, peakGain: 0.45 },
    shimmer: { freqStart: 400, freqEnd: 1800, duration: 0.14, gain: 0.15, delay: 0 },
    thump: { freq: 200, duration: 0.2, gain: 0.3, delay: 0.09 },
  },
  // Agent deleted — energy collapsing inward, ending on a deep boom.
  agentDeleted: {
    noiseSweep: { freqStart: 4000, freqEnd: 150, duration: 0.22, q: 1.1, peakGain: 0.5 },
    thump: { freq: 80, duration: 0.3, gain: 0.5, delay: 0.16 },
  },
};

/** Fire-and-forget UI sound effects. Each event plays its user-selected variant (see
 * `variants`, sourced from Settings → App Sounds) from a pre-rendered clip under
 * public/audio/sfx/<event>/v<n>.wav, falling back to the original Web Audio synthesis
 * below (no audio assets, no third-party library — mirrors useSpeak's silent-no-op
 * fallback pattern) if the file fails to load/play for any reason. "startup" instead
 * defaults its v1 to the original recorded clip (start-sound.mp3) rather than a
 * generated one. */
export function useSoundFX(enabled: boolean, variants: Record<SoundFxEvent, number>) {
  const ctxRef = useRef<AudioContext | null>(null);
  const startupAudioRef = useRef<HTMLAudioElement | null>(null);
  const clipCacheRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const getCtx = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    if (!ctxRef.current) ctxRef.current = new AudioContextCtor();
    if (ctxRef.current.state === "suspended") ctxRef.current.resume().catch(() => {});
    return ctxRef.current;
  }, []);

  const playTones = useCallback(
    (tones: Tone[]) => {
      const ctx = getCtx();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        for (const { freq, sweepTo, type, start, duration } of tones) {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.type = type;
          const startAt = now + start;
          const endAt = startAt + duration;
          oscillator.frequency.setValueAtTime(freq, startAt);
          if (sweepTo !== undefined) {
            oscillator.frequency.exponentialRampToValueAtTime(sweepTo, endAt);
          }
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.25, startAt + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
          oscillator.connect(gain);
          gain.connect(ctx.destination);
          oscillator.start(startAt);
          oscillator.stop(endAt + 0.02);
        }
      } catch {
        // Autoplay policy or unsupported environment — silent, same as useSpeak.
      }
    },
    [getCtx]
  );

  const playNoiseSweep = useCallback((ctx: AudioContext, now: number, layer: NoiseSweepLayer) => {
    const { freqStart, freqEnd, duration, q, peakGain } = layer;
    const endAt = now + duration;

    const sampleCount = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, sampleCount, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) data[i] = Math.random() * 2 - 1;

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.setValueAtTime(q, now);
    filter.frequency.setValueAtTime(freqStart, now);
    filter.frequency.exponentialRampToValueAtTime(freqEnd, endAt);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peakGain, now + duration * 0.25);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(endAt + 0.02);
  }, []);

  const playSweepTone = useCallback(
    (ctx: AudioContext, now: number, layer: ShimmerLayer | ThumpLayer, freqEnd?: number) => {
      const startAt = now + layer.delay;
      const endAt = startAt + layer.duration;
      const oscillator = ctx.createOscillator();
      oscillator.type = "sine";
      const startFreq = "freqStart" in layer ? layer.freqStart : layer.freq;
      oscillator.frequency.setValueAtTime(startFreq, startAt);
      if (freqEnd !== undefined) oscillator.frequency.exponentialRampToValueAtTime(freqEnd, endAt);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(layer.gain, startAt + layer.duration * 0.2);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.02);
    },
    []
  );

  const playSciFi = useCallback(
    (variant: SciFiVariant) => {
      const ctx = getCtx();
      if (!ctx) return;
      try {
        const { noiseSweep, shimmer, thump } = variant;
        const now = ctx.currentTime;
        playNoiseSweep(ctx, now, noiseSweep);
        if (shimmer) playSweepTone(ctx, now, shimmer, shimmer.freqEnd);
        if (thump) playSweepTone(ctx, now, thump);
      } catch {
        // Autoplay policy or unsupported environment — silent, same as useSpeak.
      }
    },
    [getCtx, playNoiseSweep, playSweepTone]
  );

  const playSynthFallback = useCallback(
    (event: SoundFxEvent) => {
      if (event === "agentCreated" || event === "agentDeleted") {
        playSciFi(SCIFI_TONES[event]);
      } else {
        playTones(TONES[event]);
      }
    },
    [playTones, playSciFi]
  );

  return useCallback(
    (event: SoundFxEvent) => {
      if (!enabled) return;
      if (typeof window === "undefined") return;

      const variant = variants[event] ?? 1;

      if (event === "startup" && variant === 1) {
        try {
          if (!startupAudioRef.current) startupAudioRef.current = new Audio(STARTUP_SOUND_SRC);
          const el = startupAudioRef.current;
          el.currentTime = 0;
          el.play().catch(() => playTones(TONES.startup));
        } catch {
          playTones(TONES.startup);
        }
        return;
      }

      try {
        const cacheKey = `${event}-${variant}`;
        let el = clipCacheRef.current.get(cacheKey);
        if (!el) {
          el = new Audio(sfxSrc(event, variant));
          clipCacheRef.current.set(cacheKey, el);
        }
        el.currentTime = 0;
        el.play().catch(() => playSynthFallback(event));
      } catch {
        playSynthFallback(event);
      }
    },
    [enabled, variants, playTones, playSynthFallback]
  );
}
