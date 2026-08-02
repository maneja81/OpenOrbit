import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Combobox from "./Combobox";
import Modal from "./Modal";

const OPTIONS = [
  { value: "docs", label: "Documents" },
  { value: "invoices", label: "Invoices" },
];

function searchInput() {
  return screen.getByRole("listbox").querySelector("input")!;
}

describe("Combobox", () => {
  afterEach(cleanup);

  it("closes its menu on Escape", () => {
    render(<Combobox value="docs" options={OPTIONS} onChange={vi.fn()} ariaLabel="Category" />);

    fireEvent.click(screen.getByLabelText("Category"));
    fireEvent.keyDown(searchInput(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  /** Comboboxes open inside modals — KnowledgeModal's per-row category, several in Settings —
   * and Modal listens for Escape on `document`. Left to bubble, one press dismissed the menu
   * and closed the modal around it in the same keystroke. */
  it("does not close the modal it is opened inside", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <Combobox value="docs" options={OPTIONS} onChange={vi.fn()} ariaLabel="Category" />
      </Modal>
    );

    fireEvent.click(screen.getByLabelText("Category"));
    fireEvent.keyDown(searchInput(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  /** The modal must still take Escape once the menu is shut — consuming the key is scoped to
   * the press that closes the menu, not a blanket block. */
  it("leaves Escape to the modal once its menu is closed", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        <Combobox value="docs" options={OPTIONS} onChange={vi.fn()} ariaLabel="Category" />
      </Modal>
    );

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
