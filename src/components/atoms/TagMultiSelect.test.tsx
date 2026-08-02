import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import TagMultiSelect from "./TagMultiSelect";
import Modal from "./Modal";

const OPTIONS = [
  { value: "read", label: "Read files" },
  { value: "write", label: "Write files" },
];

function searchInput() {
  return screen.getByRole("listbox").querySelector("input")!;
}

describe("TagMultiSelect", () => {
  afterEach(cleanup);

  it("closes its menu on Escape", () => {
    render(<TagMultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} ariaLabel="Tools" />);

    fireEvent.click(screen.getByLabelText("Tools"));
    fireEvent.keyDown(searchInput(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  /** This renders inside AgentAccordion, which lives in the Settings modal, and Modal listens
   * for Escape on `document`. Left to bubble, dismissing the tag menu closed Settings with it. */
  it("does not close the modal it is opened inside", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} label="Settings">
        <TagMultiSelect values={[]} options={OPTIONS} onChange={vi.fn()} ariaLabel="Tools" />
      </Modal>
    );

    fireEvent.click(screen.getByLabelText("Tools"));
    fireEvent.keyDown(searchInput(), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
