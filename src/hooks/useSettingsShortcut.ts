import { useEffect } from "react";

/** Cmd+, on macOS, Ctrl+, everywhere else — the standard OS convention for "open
 * preferences". The app has no native menu bar (frameless window), so this is wired
 * up as a renderer-level shortcut instead of a Menu accelerator. */
export function useSettingsShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        onOpen();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onOpen]);
}
