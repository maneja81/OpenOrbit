import { describe, expect, it } from "vitest";
import { deriveCategoryTabs } from "./knowledgeCategories";

function file(category: string): KnowledgebaseFileRecord {
  return {
    id: Math.random(),
    path: "",
    title: "",
    originalName: "",
    category,
    syncedAt: null,
    createdAt: "",
    sourceUrl: null,
    kind: "file",
  };
}

describe("deriveCategoryTabs", () => {
  it("always puts 'All' first", () => {
    expect(deriveCategoryTabs([file("Accounting")])[0]).toBe("All");
  });

  it("dedupes and sorts categories alphabetically after 'All'", () => {
    const tabs = deriveCategoryTabs([file("Resumes"), file("Accounting"), file("Resumes")]);
    expect(tabs).toEqual(["All", "Accounting", "Resumes"]);
  });

  it("returns just 'All' for an empty file list", () => {
    expect(deriveCategoryTabs([])).toEqual(["All"]);
  });
});
