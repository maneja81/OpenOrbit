/**
 * KnowledgeAgent tools — knowledge base for the user's reference material.
 *
 * Two tools:
 *   list_knowledgebase_files  — list files in the knowledge base
 *   read_knowledgebase_file   — read the stored content of one KB file
 *
 * Long-term memory (remember/recall/forget) moved to the orchestrator directly
 * (session-message history + search_conversation_history tool) — KnowledgeAgent is
 * knowledge-base only now.
 *
 * These are pure functions over the DB; they do NOT call ipcMain (wrong process layer).
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getDb } from "../../db";

// ─── Knowledge base tools ──────────────────────────────────────────────────────

type KnowledgebaseFileRow = {
  id: number;
  path: string;
  title: string;
  category: string;
  synced_at: string | null;
  /** 'file'/'url' rows hold readable content; a 'folder' row is a handle to a granted directory
   * and is browsed with list_folder_contents instead (see migration 33). */
  kind: string;
};

// Escapes SQLite LIKE metacharacters so a literal "%" or "_" in a category name is matched
// as text rather than treated as a wildcard.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

export async function listKnowledgebaseFiles({ category }: { category?: string }): Promise<{ total: number; files: KnowledgebaseFileRow[] }> {
  const db = getDb();
  const rows = (
    category
      ? db
          .prepare(
            "SELECT id, path, title, category, synced_at, kind FROM knowledge_files WHERE category LIKE ? ESCAPE '\\' ORDER BY title COLLATE NOCASE"
          )
          .all(`%${escapeLike(category)}%`)
      : db
          .prepare("SELECT id, path, title, category, synced_at, kind FROM knowledge_files ORDER BY title COLLATE NOCASE")
          .all()
  ) as KnowledgebaseFileRow[];
  return { total: rows.length, files: rows };
}

export const listKnowledgebaseFilesTool = tool({
  name: "list_knowledgebase_files",
  description:
    "List everything in the knowledge base (title, path, category, when last synced, and kind). Optionally " +
    "filter by a partial, case-insensitive category match. Use this to discover what reference material is " +
    "available before reading. Each entry's `kind` says how to open it: 'file' and 'url' entries are read with " +
    "read_knowledgebase_file, while a 'folder' entry is a local directory the user attached — browse it with " +
    "list_folder_contents and read what's inside with read_folder_file. One call covers both, so there is no " +
    "need to call list_granted_folders as well.",
  parameters: z.object({
    category: z
      .string()
      .optional()
      .describe(
        "Partial category to filter by, case-insensitive (e.g. 'Account' matches 'Accounting'). Omit to list every file."
      ),
  }),
  execute: listKnowledgebaseFiles,
});

export async function readKnowledgebaseFile({ id }: { id: number }): Promise<{
  id: number;
  path: string;
  title: string;
  syncedAt: string | null;
  content: string;
}> {
  const db = getDb();
  const row = db
    .prepare("SELECT id, path, title, content, synced_at, kind FROM knowledge_files WHERE id = ?")
    .get(id) as
    | { id: number; path: string; title: string; content: string; synced_at: string | null; kind: string }
    | undefined;
  if (!row) {
    throw new Error(`No knowledge-base file found with id ${id}.`);
  }
  // A folder entry stores no content — returning its empty string would read as "this folder is
  // empty" and end the search. Point at the tool that can actually open it instead.
  if (row.kind === "folder") {
    throw new Error(
      `"${row.title}" is an attached folder, not a document. Use list_folder_contents with path "${row.path}" ` +
        `to see what's inside it, then read_folder_file to read any file there.`
    );
  }
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    syncedAt: row.synced_at,
    content: row.content,
  };
}

export const readKnowledgebaseFileTool = tool({
  name: "read_knowledgebase_file",
  description:
    "Read the stored content of a knowledge-base file by its id. Content is capped at 100 KB; the text ends with '[...truncated]' if the original was longer. Use list_knowledgebase_files first to find the id.",
  parameters: z.object({
    id: z.number().int().positive().describe("The id of the knowledge-base file to read."),
  }),
  execute: readKnowledgebaseFile,
});
