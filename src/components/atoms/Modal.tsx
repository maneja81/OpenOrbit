import { ReactNode, RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Accessible name for the dialog. Required rather than optional: `aria-modal="true"` without
   * a name announces as an unnamed "dialog", which is what every modal in the app did before.
   * Pass the same words as the visible heading so the two can't drift. */
  label: string;
  /** Whether a click on the backdrop closes the modal. Default true.
   *
   * Set false for a modal whose `onClose` is itself an answer rather than a dismissal —
   * HttpToolApprovalModal declines the tool call, so a mis-aimed click would silently answer a
   * security prompt. Escape stays live either way: it is a deliberate keypress, and WAI-ARIA
   * expects a dialog to honour it. */
  closeOnBackdrop?: boolean;
}

/** Every open Modal listens on `document` for Escape, so one keypress reached all of them — a
 * modal opened from inside another (AddUrlModal from KnowledgeModal) closed both at once. Open
 * modals register here in the order they opened and only the last one reacts.
 *
 * Each instance is identified by its own `panelRef` object, which is stable for the lifetime of
 * the component and unique per instance. */
const openModals: RefObject<HTMLDivElement | null>[] = [];

/** Tab order inside the panel. `:not([disabled])` matters for the type-to-confirm modals, whose
 * primary button is disabled until the confirm word matches — a trap that cycled onto it would
 * strand the keyboard on a control that does nothing. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({
  open,
  onClose,
  children,
  className = "",
  label,
  closeOnBackdrop = true,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // Registration is deliberately kept in its own effect keyed on `open` alone. Folding it into
  // the keydown effect below would re-order the stack every time the parent re-rendered with a
  // fresh `onClose`, putting an outer modal back on top of the inner one it just opened.
  //
  // Focus restoration rides along here because it wants exactly this lifecycle: capture on the
  // way in, restore on the way out, once per open — not once per `onClose` identity change.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement;
    returnFocusTo.current = previouslyFocused instanceof HTMLElement ? previouslyFocused : null;
    openModals.push(panelRef);
    return () => {
      const i = openModals.indexOf(panelRef);
      if (i !== -1) openModals.splice(i, 1);
      // `isConnected` guards the case where the trigger was itself removed while the modal was
      // open (deleting a row from its own row-level button), where focusing it does nothing and
      // focus would silently fall to <body> anyway.
      const target = returnFocusTo.current;
      if (target?.isConnected) target.focus();
      returnFocusTo.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (openModals[openModals.length - 1] !== panelRef) return;
      if (e.key === "Escape") {
        onClose();
        return;
      }
      // `aria-modal="true"` tells assistive tech the rest of the page is inert. Nothing enforced
      // that for actual keyboard focus, so Tab from the last control walked out of the dialog
      // and into the page behind the backdrop — where the user could operate the app while a
      // modal claimed to be modal.
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        // Nothing to cycle between: keep focus on the panel rather than letting Tab escape.
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      // Focus sitting on the panel itself (the U4 fallback below) counts as "before the first
      // control", so a plain Tab from there should land on `first`, not escape.
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Moves focus into the modal's first text field as soon as it opens, so typing can
  // start immediately with no extra click (CLAUDE.md's UX Conventions) — generic here
  // rather than per-modal so every current and future Modal user gets it automatically.
  // Checkboxes/radios are excluded since they're rarely the field a modal "is about" (e.g.
  // KnowledgeModal's per-row selection checkboxes shouldn't steal focus on open).
  //
  // The fallbacks matter as much as the preferred case: HttpToolApprovalModal and
  // AgentInfoModal contain no text field at all, so this used to move focus nowhere and left
  // a keyboard user tabbing in from the document start to reach Approve / Don't run.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    const firstField = panel.querySelector<HTMLElement>(
      'input:not([type="checkbox"]):not([type="radio"]), textarea'
    );
    if (firstField) {
      firstField.focus();
      return;
    }
    // No text field. Prefer the panel itself over the first button: on a consequential confirm
    // the first control is an action, and opening with it focused makes Enter approve something
    // the user has not read yet.
    panel.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => closeOnBackdrop && e.target === e.currentTarget && onClose()}
    >
      <div
        className={`modal-panel${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        ref={panelRef}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
