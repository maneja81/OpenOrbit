import { describe, expect, it, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { useState } from "react";
import Modal from "./Modal";

/** Every open Modal listens on `document`, so without a stack a single Escape reached all of
 * them — the app nests modals for real (AddUrlModal opens from inside KnowledgeModal), where
 * that closed the knowledge base out from under the user. */
describe("Modal", () => {
  afterEach(cleanup);

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="Body">
        <p>body</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes only the inner modal when one is opened from inside another", () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();

    function Nested() {
      // The inner modal opens on click rather than on mount, matching how KnowledgeModal opens
      // AddUrlModal — the outer modal re-renders as it happens, which is what used to reorder
      // the two listeners.
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <Modal open onClose={onCloseOuter} label="Outer">
          <button onClick={() => setInnerOpen(true)}>open inner</button>
          <Modal open={innerOpen} onClose={onCloseInner} label="Inner">
            <p>inner</p>
          </Modal>
        </Modal>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText("open inner"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it("hands Escape back to the outer modal once the inner one has closed", () => {
    const onCloseOuter = vi.fn();

    function Nested() {
      const [innerOpen, setInnerOpen] = useState(true);
      return (
        <Modal open onClose={onCloseOuter} label="Outer">
          <button onClick={() => setInnerOpen(false)}>close inner</button>
          <Modal open={innerOpen} onClose={() => setInnerOpen(false)} label="Inner">
            <p>inner</p>
          </Modal>
        </Modal>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText("close inner"));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onCloseOuter).toHaveBeenCalledTimes(1);
  });

  it("ignores Escape while closed", () => {
    const onClose = vi.fn();
    render(
      <Modal open={false} onClose={onClose} label="Body">
        <p>body</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click by default", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <Modal open onClose={onClose} label="Body">
        <p>body</p>
      </Modal>
    );

    fireEvent.mouseDown(baseElement.querySelector(".modal-backdrop")!);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // U5 — for a modal whose onClose is an answer rather than a dismissal, a mis-aimed click must
  // not decide it. Escape stays live; it is deliberate.
  it("ignores a backdrop click when closeOnBackdrop is false", () => {
    const onClose = vi.fn();
    const { baseElement } = render(
      <Modal open onClose={onClose} label="Body" closeOnBackdrop={false}>
        <p>body</p>
      </Modal>
    );

    fireEvent.mouseDown(baseElement.querySelector(".modal-backdrop")!);

    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("ignores a click that lands inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="Body">
        <p>body</p>
      </Modal>
    );

    fireEvent.mouseDown(screen.getByText("body"));

    expect(onClose).not.toHaveBeenCalled();
  });

  // U1 — `aria-modal="true"` with no name announces as an unnamed "dialog".
  it("gives the dialog an accessible name", () => {
    render(
      <Modal open onClose={vi.fn()} label="Add from URL">
        <p>body</p>
      </Modal>
    );

    expect(screen.getByRole("dialog", { name: "Add from URL" })).toBeInTheDocument();
  });

  // U4 — the focus-on-open query only matched input/textarea, so a modal built from buttons
  // alone (HttpToolApprovalModal, AgentInfoModal) moved focus nowhere at all.
  it("focuses the first text field when the modal has one", () => {
    render(
      <Modal open onClose={vi.fn()} label="With field">
        <button>first</button>
        <input aria-label="name" />
      </Modal>
    );

    expect(document.activeElement).toBe(screen.getByLabelText("name"));
  });

  it("focuses the panel when the modal has no text field, not its first action", () => {
    render(
      <Modal open onClose={vi.fn()} label="Run this tool?">
        <button>Don't run</button>
        <button>Approve</button>
      </Modal>
    );

    // Deliberately the panel and not "Don't run": opening with an action focused makes Enter
    // answer a question the user has not read yet.
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
  });

  it("ignores checkboxes when choosing what to focus", () => {
    render(
      <Modal open onClose={vi.fn()} label="Knowledge">
        <input type="checkbox" aria-label="select row" />
        <input aria-label="search" />
      </Modal>
    );

    expect(document.activeElement).toBe(screen.getByLabelText("search"));
  });

  // U2 — `aria-modal="true"` asserts the background is inert; nothing enforced it for focus.
  it("wraps Tab from the last control back to the first", () => {
    render(
      <Modal open onClose={vi.fn()} label="Trapped">
        <button>first</button>
        <button>last</button>
      </Modal>
    );

    const first = screen.getByText("first");
    const last = screen.getByText("last");
    last.focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(first);
  });

  it("wraps Shift+Tab from the first control back to the last", () => {
    render(
      <Modal open onClose={vi.fn()} label="Trapped">
        <button>first</button>
        <button>last</button>
      </Modal>
    );

    const first = screen.getByText("first");
    const last = screen.getByText("last");
    first.focus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(last);
  });

  it("traps Tab in the inner modal only, leaving the outer one alone", () => {
    // Inner opens on click, not on mount — same as the Escape tests above, and the same as the
    // only nesting the app actually does (KnowledgeModal opens AddUrlModal). Mounting both
    // already-open registers them child-effect-first, which is not a state the app reaches.
    function Nested() {
      const [innerOpen, setInnerOpen] = useState(false);
      return (
        <Modal open onClose={vi.fn()} label="Outer">
          <button onClick={() => setInnerOpen(true)}>open inner</button>
          <Modal open={innerOpen} onClose={vi.fn()} label="Inner">
            <button>inner first</button>
            <button>inner last</button>
          </Modal>
        </Modal>
      );
    }

    render(<Nested />);
    fireEvent.click(screen.getByText("open inner"));
    const innerFirst = screen.getByText("inner first");
    screen.getByText("inner last").focus();

    fireEvent.keyDown(document, { key: "Tab" });

    expect(document.activeElement).toBe(innerFirst);
  });

  // U3 — nothing recorded the trigger, so closing any modal dropped focus to <body> and a
  // keyboard user restarted from the top of the document.
  it("restores focus to whatever was focused before it opened", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>trigger</button>
          <Modal open={open} onClose={() => setOpen(false)} label="Body">
            <button onClick={() => setOpen(false)}>close</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.click(screen.getByText("close"));

    expect(document.activeElement).toBe(trigger);
  });

  it("does not throw when the trigger was removed while the modal was open", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      const [triggerPresent, setTriggerPresent] = useState(true);
      return (
        <>
          {triggerPresent && (
            <button
              onClick={() => {
                setOpen(true);
                setTriggerPresent(false);
              }}
            >
              trigger
            </button>
          )}
          <Modal open={open} onClose={() => setOpen(false)} label="Body">
            <button onClick={() => setOpen(false)}>close</button>
          </Modal>
        </>
      );
    }

    render(<Harness />);
    const trigger = screen.getByText("trigger");
    trigger.focus();
    fireEvent.click(trigger);

    expect(() => fireEvent.click(screen.getByText("close"))).not.toThrow();
  });
});
