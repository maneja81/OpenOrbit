import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "../../db/migrations";

let db: Database.Database;

vi.mock("../../db", () => ({
  getDb: () => db,
}));

import { listKnowledgebaseFiles, readKnowledgebaseFile } from "./knowledgeAgentTools";

function insertKnowledgebaseFile(db: Database.Database, title: string, category: string) {
  db.prepare(
    "INSERT INTO knowledge_files (path, title, content, category, synced_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).run(`/fake/${title}`, title, "content", category);
}

describe("list_knowledgebase_files category filter", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    insertKnowledgebaseFile(db, "HDFC Statement Sept 2024", "Banking");
    insertKnowledgebaseFile(db, "Resume", "Education");
  });

  it("matches a category that only partially overlaps the filter, case-insensitively", async () => {
    const result = await listKnowledgebaseFiles({ category: "bank" });
    expect(result.total).toBe(1);
    expect(result.files[0].title).toBe("HDFC Statement Sept 2024");
  });

  it("returns every file when no category filter is given", async () => {
    const result = await listKnowledgebaseFiles({ category: undefined });
    expect(result.total).toBe(2);
  });

  it("returns nothing when the partial filter matches no category", async () => {
    const result = await listKnowledgebaseFiles({ category: "Legal" });
    expect(result.total).toBe(0);
  });

  it("treats a literal % in the category filter as text, not a wildcard", async () => {
    insertKnowledgebaseFile(db, "Q3 Report", "100%");
    const result = await listKnowledgebaseFiles({ category: "100%" });
    expect(result.total).toBe(1);
    expect(result.files[0].title).toBe("Q3 Report");
  });
});

describe("attached folders in the knowledge base listing", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    runMigrations(db);
    insertKnowledgebaseFile(db, "Resume", "Education");
    db.prepare(
      "INSERT INTO knowledge_files (path, title, content, category, kind, synced_at) VALUES (?, ?, '', ?, 'folder', datetime('now'))"
    ).run("/Users/x/Documents", "Documents", "Folders");
  });

  it("returns folders alongside documents from one call, tagged by kind", async () => {
    const result = await listKnowledgebaseFiles({ category: undefined });

    expect(result.total).toBe(2);
    expect(result.files.map((f) => [f.title, f.kind]).sort()).toEqual([
      ["Documents", "folder"],
      ["Resume", "file"],
    ]);
  });

  it("refuses to read a folder as a document and names the tool that can open it", async () => {
    const folder = (await listKnowledgebaseFiles({ category: "Folders" })).files[0];

    // Returning the row's empty content instead would read to the model as "this folder is empty".
    await expect(readKnowledgebaseFile({ id: folder.id })).rejects.toThrow(
      /attached folder.*list_folder_contents/s
    );
  });

  it("still reads an ordinary document's content", async () => {
    const doc = (await listKnowledgebaseFiles({ category: "Education" })).files[0];

    await expect(readKnowledgebaseFile({ id: doc.id })).resolves.toMatchObject({
      title: "Resume",
      content: "content",
    });
  });
});
