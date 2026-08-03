import { useEffect, useRef } from "react";

// Document-relative, not "/audio/…": built renderers load over file://, where a
// root-absolute path resolves to file:///audio/… and the track never loads.
const BG_MUSIC_SRC = "./audio/bg.mp3";

/** Loops the ambient background track at `volume` (Settings → General, default 0.1 — a
 * low, unobtrusive level) while `enabled` is true. Browsers/Electron can block autoplay
 * until a user gesture, so a failed play() is retried once on the next click/keydown
 * instead of surfacing an error. */
export function useBackgroundMusic(enabled: boolean, volume: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const volumeRef = useRef(volume);

  useEffect(() => {
    volumeRef.current = volume;
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);
  // Always holds the latest `enabled` value so the window-level gesture listener below
  // (registered by an earlier render, potentially with `enabled=true` in its closure)
  // can re-check the *current* desired state instead of blindly playing — otherwise the
  // very first click after mount, even one intended to mute (disable), would still start
  // playback: the click both flips `enabled` to false AND satisfies the pending "retry on
  // gesture" listener from the still-mounted effect, so audio would audibly start for a
  // moment despite the user clicking mute. This made toggling off feel like it only
  // "reduced" the sound instead of cleanly stopping it.
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!enabled) {
      audioRef.current?.pause();
      return;
    }

    if (!audioRef.current) {
      const el = new Audio(BG_MUSIC_SRC);
      el.loop = true;
      el.volume = volumeRef.current;
      audioRef.current = el;
    }
    const el = audioRef.current;
    // Guards against a stale effect run's async play() rejection acting after this run has
    // already been superseded/cleaned up (see the NotAllowedError check below for why this
    // matters — without both guards together, a discarded Audio instance from an earlier
    // run could resurrect itself via a later, unrelated click and loop forever with no
    // reference the mute toggle can ever reach again).
    let cancelled = false;

    const retryOnGesture = () => {
      window.removeEventListener("click", retryOnGesture);
      window.removeEventListener("keydown", retryOnGesture);
      if (!cancelled && enabledRef.current) el.play().catch(() => {});
    };

    el.play().catch((e: unknown) => {
      // Only a real autoplay block (NotAllowedError) should wait for a gesture and retry.
      // React StrictMode's dev-only double-invoke of this effect (mount → cleanup → mount)
      // pauses this exact `el` via the disable branch above before this promise even
      // settles, which rejects it with AbortError instead — an unrelated interruption, not
      // a blocked autoplay. Treating that as "retry on next gesture" was the actual bug:
      // the next click anywhere in the app would call .play() on this already-orphaned,
      // no-longer-tracked instance, starting a second untracked audio loop that keeps
      // playing forever regardless of the mute toggle (audioRef only ever points at the
      // *current* instance, not this stale one).
      if (cancelled || (e instanceof DOMException && e.name !== "NotAllowedError")) return;
      window.addEventListener("click", retryOnGesture);
      window.addEventListener("keydown", retryOnGesture);
    });

    return () => {
      cancelled = true;
      window.removeEventListener("click", retryOnGesture);
      window.removeEventListener("keydown", retryOnGesture);
    };
  }, [enabled]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
      audioRef.current = null;
    },
    []
  );
}
