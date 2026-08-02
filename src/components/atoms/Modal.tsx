import { ReactNode, RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/** Every open Modal listens on `document` for Escape, so one keypress reached all of them — a
 * modal opened from inside another (AddUrlModal from KnowledgeModal) closed both at once. Open
 * modals register here in the order they opened and only the last one reacts.
 *
 * Each instance is identified by its own `panelRef` object, which is stable for the lifetime of
 * the component and unique per instance. */
const openModals: RefObject<HTMLDivElement | null>[] = [];

export default function Modal({ open, onClose, children, className = "" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Registration is deliberately kept in its own effect keyed on `open` alone. Folding it into
  // the keydown effect below would re-order the stack every time the parent re-rendered with a
  // fresh `onClose`, putting an outer modal back on top of the inner one it just opened.
  useEffect(() => {
    if (!open) return;
    openModals.push(panelRef);
    return () => {
      const i = openModals.indexOf(panelRef);
      if (i !== -1) openModals.splice(i, 1);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (openModals[openModals.length - 1] !== panelRef) return;
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Moves focus into the modal's first text field as soon as it opens, so typing can
  // start immediately with no extra click (CLAUDE.md's UX Conventions) — generic here
  // rather than per-modal so every current and future Modal user gets it automatically.
  // Checkboxes/radios are excluded since they're rarely the field a modal "is about" (e.g.
  // KnowledgeModal's per-row selection checkboxes shouldn't steal focus on open).
  useEffect(() => {
    if (!open) return;
    const firstField = panelRef.current?.querySelector<HTMLElement>(
      'input:not([type="checkbox"]):not([type="radio"]), textarea'
    );
    firstField?.focus();
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal-panel${className ? ` ${className}` : ""}`} role="dialog" aria-modal="true" ref={panelRef}>
        {children}
      </div>
    </div>,
    document.body
  );
}
