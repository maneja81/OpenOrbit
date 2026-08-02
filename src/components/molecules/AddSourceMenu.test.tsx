import { describe, expect, it, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import AddSourceMenu from "./AddSourceMenu";

// jsdom implements no layout, so it has no scrollIntoView — SlashCommandMenu calls it to keep the
// arrow-key selection visible inside its scroll window.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/** CLAUDE.md's UX conventions require every option menu to support Up/Down, Enter to select, and
 * Escape to close — the same contract SlashCommandMenu already meets. This menu is the only way to
 * attach a folder or add a URL from the widget, so that contract is load-bearing here. */
describe("AddSourceMenu keyboard navigation", () => {
  afterEach(cleanup);

  function open() {
    const onSelect = vi.fn();
    render(<AddSourceMenu onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Add to knowledge base"));
    return onSelect;
  }

  it("offers all three ways into the knowledge base", () => {
    open();
    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Folder")).toBeTruthy();
    expect(screen.getByText("URL")).toBeTruthy();
  });

  it("selects the highlighted item on Enter", () => {
    const onSelect = open();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("folder");
  });

  it("wraps around when arrowing past the last item", () => {
    const onSelect = open();
    const menu = screen.getByRole("listbox");

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith("url");
  });

  it("closes on Escape without selecting anything", () => {
    const onSelect = open();

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("closes after a selection so the menu can't stay open over the card", () => {
    open();

    fireEvent.mouseDown(screen.getByText("File"));

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes when something outside it is clicked", () => {
    open();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });

  /** The menu is portalled to document.body, so it is not inside the component's own container
   * — an outside-click check that only looks at the container treats every click on the menu
   * itself as a click outside. */
  it("stays open when the click lands inside the portalled menu", () => {
    open();

    fireEvent.mouseDown(screen.getByRole("listbox"));

    expect(screen.queryByRole("listbox")).not.toBeNull();
  });
});
