import { useEffect } from "react";

interface UseVoiceShortcutOptions {
  enabled: boolean;
  listening: boolean;
  startVoice: () => void;
  stopVoice: () => void;
}

/** Press-and-hold Cmd+D (macOS) / Ctrl+D (Windows/Linux): keydown starts voice input,
 * releasing the key stops it. Pressing Cmd+D again while recording also stops it — this
 * matters because macOS suppresses the keyup event for a non-modifier key while Cmd is
 * still held, so a quick tap-and-release with Cmd held down never fires our keyup handler.
 * Esc cancels recording regardless of how it was started (button click or keyboard shortcut). */
export function useVoiceShortcut({ enabled, listening, startVoice, stopVoice }: UseVoiceShortcutOptions) {
  useEffect(() => {
    if (!enabled) return;
    let held = false;

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        if (e.repeat) return; // ignore OS key-repeat while held
        if (held || listening) {
          held = false;
          stopVoice();
          return;
        }
        held = true;
        startVoice();
        return;
      }
      // Stop recording on Escape whether it was started via Cmd+D or the mic button.
      if (e.key === "Escape" && (held || listening)) {
        e.preventDefault();
        held = false;
        stopVoice();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "d" || !held) return;
      held = false;
      stopVoice();
    };
    const onBlur = () => {
      if (!held) return;
      held = false;
      stopVoice();
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, listening, startVoice, stopVoice]);
}
