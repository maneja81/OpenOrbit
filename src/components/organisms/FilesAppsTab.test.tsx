import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";

const useSharedKnowledgeFiles = vi.fn();

vi.mock("@/hooks/useKnowledgeFiles", () => ({
  useSharedKnowledgeFiles: () => useSharedKnowledgeFiles(),
}));

import FilesAppsTab from "./FilesAppsTab";

const removeFile = vi.fn();
const addFolder = vi.fn();
const pickAndAdd = vi.fn();

function entry(id: number, overrides: Partial<KnowledgebaseFileRecord> = {}): KnowledgebaseFileRecord {
  return {
    id,
    path: `/copies/doc-${id}.pdf`,
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

function setFiles(files: KnowledgebaseFileRecord[]) {
  // pendingIds/loading are part of the hook's contract now — a mock that omits them renders
  // `pendingIds.has(...)` against undefined and the component throws.
  useSharedKnowledgeFiles.mockReturnValue({
    files,
    error: null,
    loading: false,
    pendingIds: new Set<number>(),
    addFolder,
    pickAndAdd,
    removeFile,
  });
}

describe("FilesAppsTab", () => {
  beforeEach(() => {
    useSharedKnowledgeFiles.mockReset();
    removeFile.mockReset();
    addFolder.mockReset();
    pickAndAdd.mockReset();
    setFiles([]);
  });
  afterEach(cleanup);

  /** Saved documents used to be a count sentence pointing the user at the Knowledge widget —
   * there was no way to see which documents agents could read, or to take one away, from here. */
  it("lists saved documents and web pages", () => {
    setFiles([
      entry(1, { originalName: "contract.pdf" }),
      entry(2, { originalName: "Pricing page", kind: "url", sourceUrl: "https://example.com/pricing" }),
      entry(3, { kind: "folder", path: "/Users/me/notes", originalName: "notes" }),
    ]);
    render(<FilesAppsTab />);

    expect(screen.getByText("contract.pdf")).toBeTruthy();
    expect(screen.getByText("Pricing page")).toBeTruthy();
  });

  it("removes a saved document", () => {
    setFiles([entry(7, { originalName: "contract.pdf" })]);
    render(<FilesAppsTab />);

    fireEvent.click(screen.getByLabelText("Remove contract.pdf"));

    expect(removeFile).toHaveBeenCalledWith(7);
  });

  /** A folder is a live grant over the user's own directory, so its label has to say "revoke
   * access" rather than "remove" — the two kinds must not share one row treatment. */
  it("keeps folders out of the documents list and labels their removal as revoking access", () => {
    setFiles([entry(3, { kind: "folder", path: "/Users/me/notes", originalName: "notes" })]);
    render(<FilesAppsTab />);

    expect(screen.getByLabelText("Remove access to /Users/me/notes")).toBeTruthy();
    expect(screen.queryByLabelText("Remove notes")).toBeNull();
    expect(screen.getByText(/Nothing saved yet/)).toBeTruthy();
  });

  it("adds folders and documents from Settings", () => {
    render(<FilesAppsTab />);

    fireEvent.click(screen.getByText("Add folder"));
    expect(addFolder).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Add documents"));
    expect(pickAndAdd).toHaveBeenCalledTimes(1);
  });
});
