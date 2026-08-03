import Database from "better-sqlite3";
import { app } from "electron";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { runMigrations } from "./migrations";
import { getDatabaseDir, getKnowledgeFilesDir, getLegacyAppRoot, getLegacyAppRoots } from "../appDirs";

let db: Database.Database | null = null;

// alex.db used to live directly under userData; moved into userData/database alongside
// the other app-owned folders (mcp/skills/workflows/user). Migrates in place on first
// launch after the change so existing installs don't lose their data — also carries
// over the WAL/SHM sidecar files journal_mode=WAL produces alongside the main db file.
function migrateLegacyDbLocation(oldPath: string, newPath: string): void {
  if (existsSync(newPath) || !existsSync(oldPath)) return;
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${oldPath}${suffix}`;
    const to = `${newPath}${suffix}`;
    if (existsSync(from)) renameSync(from, to);
  }
}

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = path.join(getDatabaseDir(), "agents.db");
  // Same in-place rename helper used for the earlier filename move: renames the
  // legacy alex.db (from its original pre-rebrand userData root, that root's own
  // database/ dir, or the current userData root) to agents.db, carrying over WAL/SHM
  // sidecars. Tried in most-to-least-likely order; each call is a no-op once dbPath exists.
  migrateLegacyDbLocation(path.join(getLegacyAppRoot(), "database", "alex.db"), dbPath);
  migrateLegacyDbLocation(path.join(getLegacyAppRoot(), "alex.db"), dbPath);
  migrateLegacyDbLocation(path.join(app.getPath("userData"), "alex.db"), dbPath);
  migrateLegacyDbLocation(path.join(getDatabaseDir(), "alex.db"), dbPath);
  // Assigned to a local first, and only promoted to the module-level singleton once
  // runMigrations returns successfully — otherwise a migration that throws leaves `db`
  // already set, and the `if (db) return db` guard above hands every subsequent call the
  // half-migrated connection instead of retrying or failing loudly.
  const opened = new Database(dbPath);
  opened.pragma("journal_mode = WAL");
  // SQLite has FK enforcement off per-connection by default — without this, messages.conversation_id's
  // REFERENCES/ON DELETE CASCADE in the schema would silently not be enforced.
  opened.pragma("foreign_keys = ON");
  // Migration v31 re-points knowledge_files.path rows after an app rename moves the
  // knowledge-files directory. The paths are resolved here rather than inside migrations.ts,
  // which stays free of runtime imports so it can run against a bare in-memory database.
  const knowledgeFilesDir = getKnowledgeFilesDir();
  const knowledgeDirName = path.basename(knowledgeFilesDir);
  runMigrations(opened, {
    knowledgeFilesDir,
    legacyKnowledgeFilesDirs: getLegacyAppRoots().map((legacyRoot) => path.join(legacyRoot, knowledgeDirName)),
  });
  db = opened;
  return db;
}
