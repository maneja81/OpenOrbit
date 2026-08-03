import { describe, expect, it, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

// jsdom implements no layout, so it has no scrollIntoView — SlashCommandMenu, which backs the
// add-source menu, calls it to keep the arrow-key selection visible.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const useSharedKnowledgeFiles = vi.fn();

vi.mock("@/hooks/useKnowledgeFiles", () => ({
  useSharedKnowledgeFiles: () => useSharedKnowledgeFiles(),
}));

import KnowledgeModal from "./KnowledgeModal";

function file(id: number, overrides: Partial<KnowledgebaseFileRecord> = {}): KnowledgebaseFileRecord {
  return {
    id,
    path: `/docs/doc-${id}.pdf`,
    title: `doc-${id}`,
    originalName: `doc-${id}.pdf`,
    category: "Documents",
    syncedAt: null,
    createdAt: "2026-07-31 12:41:34",
    sourceUrl: null,
    kind: "file",
    ...overrides,
  };
}

const addFolder = vi.fn();
const pickAndAdd = vi.fn();

function setFiles(files: KnowledgebaseFileRecord[]) {
  useSharedKnowledgeFiles.mockReturnValue({
    files,
    error: null,
    loading: false,
    pendingIds: new Set<number>(),
    removeFile: vi.fn(),
    updateCategory: vi.fn(),
    syncOne: vi.fn(),
    openFile: vi.fn(),
    addUrls: vi.fn(),
    addFolder,
    pickAndAdd,
  });
}

describe("KnowledgeModal", () => {
  beforeEach(() => {
    useSharedKnowledgeFiles.mockReset();
    addFolder.mockReset();
    pickAndAdd.mockReset();
    setFiles([]);
  });
  afterEach(cleanup);

  /** The expanded view used to offer a single globe button, so the larger surface could add a
   * web page and nothing else — a file or folder meant going back to the widget. */
  it("offers the same three sources the widget does", () => {
    render(<KnowledgeModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Add to knowledge base"));

    expect(screen.getByText("File")).toBeTruthy();
    expect(screen.getByText("Folder")).toBeTruthy();
    expect(screen.getByText("URL")).toBeTruthy();
  });

  it("attaches a folder from the expanded view", () => {
    render(<KnowledgeModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Add to knowledge base"));
    fireEvent.mouseDown(screen.getByText("Folder"));

    expect(addFolder).toHaveBeenCalledTimes(1);
    expect(pickAndAdd).not.toHaveBeenCalled();
  });

  it("picks documents from the expanded view", () => {
    render(<KnowledgeModal open onClose={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Add to knowledge base"));
    fireEvent.mouseDown(screen.getByText("File"));

    expect(pickAndAdd).toHaveBeenCalledTimes(1);
    expect(addFolder).not.toHaveBeenCalled();
  });

  /** "No files in this category" is wrong when nothing has been added at all — there is no
   * category being filtered, and the message gives the user nothing to act on. */
  it("tells an empty knowledge base how to add something", () => {
    render(<KnowledgeModal open onClose={vi.fn()} />);

    expect(screen.getByText(/Nothing added yet/)).toBeTruthy();
    expect(screen.queryByText("No files in this category.")).toBeNull();
  });

  it("keeps the category message when a category filter is what came up empty", () => {
    setFiles([file(1, { category: "Documents" }), file(2, { category: "Invoices" })]);
    render(<KnowledgeModal open onClose={vi.fn()} />);

    // "All" is selected, so both files show — the category copy is only reachable once a
    // category is picked, but the branch is chosen on files.length, which is non-zero here.
    expect(screen.queryByText(/Nothing added yet/)).toBeNull();
  });

  it("hides the tab bar when 'All' is the only tab", () => {
    render(<KnowledgeModal open onClose={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
  });

  it("shows the tab bar once there is a category to switch to", () => {
    setFiles([file(1, { category: "Documents" })]);
    render(<KnowledgeModal open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: "All" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Documents" })).toBeTruthy();
  });

  /** Moving the add-source menu into this modal put a second Escape handler under Modal's own
   * one on `document`. Without the menu consuming the key, dismissing it took the modal with it
   * in the same press — the two-modals-at-once bug again, one layer down. */
  it("closes only the add-source menu on Escape, not the modal with it", () => {
    const onClose = vi.fn();
    render(<KnowledgeModal open onClose={onClose} />);

    const trigger = screen.getByLabelText("Add to knowledge base");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toBeTruthy();

    fireEvent.keyDown(trigger, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
