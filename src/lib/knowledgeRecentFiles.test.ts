import { describe, expect, it } from "vitest";
import { selectRecentFiles } from "./knowledgeRecentFiles";

function file(id: number, createdAt: string): KnowledgebaseFileRecord {
  return {
    id,
    path: "",
    title: "",
    originalName: `f${id}`,
    category: "Uncategorized",
    syncedAt: null,
    createdAt,
    sourceUrl: null,
    kind: "file",
  };
}

function folder(id: number, title: string): KnowledgebaseFileRecord {
  return {
    id,
    path: `/granted/${title}`,
    title,
    originalName: title,
    category: "Folders",
    syncedAt: null,
    // Folders sort by name, not recency — a createdAt that would win the document sort proves
    // the pinning is doing the work rather than the timestamp.
    createdAt: "2099-01-01",
    sourceUrl: null,
    kind: "folder",
  };
}

describe("selectRecentFiles", () => {
  it("returns all files, newest first, when under the cap", () => {
    const files = [file(1, "2026-01-01"), file(2, "2026-01-03"), file(3, "2026-01-02")];
    expect(selectRecentFiles(files, 6).map((f) => f.id)).toEqual([2, 3, 1]);
  });

  it("caps at max and keeps only the most recent", () => {
    const files = [file(1, "2026-01-01"), file(2, "2026-01-02"), file(3, "2026-01-03")];
    expect(selectRecentFiles(files, 2).map((f) => f.id)).toEqual([3, 2]);
  });

  it("returns an empty array for an empty file list", () => {
    expect(selectRecentFiles([], 6)).toEqual([]);
  });

  it("pins folders above documents, sorted by name rather than recency", () => {
    const entries = [file(1, "2026-01-01"), folder(2, "Zebra"), file(3, "2026-01-03"), folder(4, "Alpha")];

    expect(selectRecentFiles(entries, 6).map((e) => e.id)).toEqual([4, 2, 3, 1]);
  });

  it("caps pinned folders at three so they can't fill the whole card", () => {
    const entries = [
      folder(1, "A"),
      folder(2, "B"),
      folder(3, "C"),
      folder(4, "D"),
      folder(5, "E"),
      file(6, "2026-01-01"),
    ];

    const result = selectRecentFiles(entries, 6);

    expect(result.map((e) => e.id)).toEqual([1, 2, 3, 6]);
    expect(result.filter((e) => e.kind === "folder")).toHaveLength(3);
  });

  it("still honours the overall cap once folders are pinned", () => {
    const entries = [folder(1, "A"), file(2, "2026-01-01"), file(3, "2026-01-02"), file(4, "2026-01-03")];

    expect(selectRecentFiles(entries, 3).map((e) => e.id)).toEqual([1, 4, 3]);
  });
});
