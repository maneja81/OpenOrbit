import { describe, expect, it, vi, afterEach } from "vitest";
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
      <Modal open onClose={onClose}>
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
        <Modal open onClose={onCloseOuter}>
          <button onClick={() => setInnerOpen(true)}>open inner</button>
          <Modal open={innerOpen} onClose={onCloseInner}>
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
        <Modal open onClose={onCloseOuter}>
          <button onClick={() => setInnerOpen(false)}>close inner</button>
          <Modal open={innerOpen} onClose={() => setInnerOpen(false)}>
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
      <Modal open={false} onClose={onClose}>
        <p>body</p>
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).not.toHaveBeenCalled();
  });
});
