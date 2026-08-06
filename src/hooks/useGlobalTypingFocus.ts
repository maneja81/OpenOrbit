import { RefObject, useEffect } from "react";

function isEditableElement(el: Element | null): boolean {
  if (!el) return false;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return true;
  return (el as HTMLElement).isContentEditable;
}

export function useGlobalTypingFocus(inputRef: RefObject<HTMLTextAreaElement | null>, enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const inp = inputRef.current;
      if (!inp || document.activeElement === inp) return;
      // A disabled textarea (ChatInputBar sets this while sendDisabled — an approval/question
      // is pending, or a run is already in flight) can't accept real user input, but nothing
      // stops a script from writing `.value` and dispatching a synthetic event on one anyway —
      // which is exactly what the two branches below do. Reading `.disabled` straight off the
      // DOM node (rather than threading a second prop through) means this can never drift out
      // of sync with whatever ChatInputBar actually rendered.
      if (inp.disabled) return;
      // Don't steal keystrokes from another focused field (Settings, onboarding, Danger
      // Zone confirm, etc.) — only redirect into chat when focus is on nothing typeable.
      if (isEditableElement(document.activeElement)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key.length === 1) {
        inp.focus();
        inp.value += e.key;
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        e.preventDefault();
      } else if (e.key === "Backspace") {
        inp.focus();
        e.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [inputRef, enabled]);
}
