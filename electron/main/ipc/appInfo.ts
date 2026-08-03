/**
 * Read-only build, storage and usage facts for the About screen (Settings → About).
 *
 * None of these handlers accept renderer arguments, so there is no caller-supplied path or
 * id to validate — unlike ipc/filesystem.ts, every path here is derived from appDirs.
 */

import { app, ipcMain, session } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getDatabaseDir, getKnowledgeFilesDir } from "../appDirs";
import { getDb } from "../db";

/** Kept as-is through the Agents → OpenOrbit rename; only the directory above it moved. */
const DATABASE_FILE = "agents.db";

// journal_mode=WAL (see db/index.ts) means the database is three files on disk, not one.
const DATABASE_SIDECARS = ["", "-wal", "-shm"];

export interface AppInfo {
  name: string;
  /** Version of the build itself, from package.json — distinct from the latest published
   * release, which the renderer reads from its build-time constants. */
  packageVersion: string;
  electronVersion: string;
  nodeVersion: string;
  chromeVersion: string;
  platform: string;
  arch: string;
  /** Marketing OS version ("15.1"), which os.release() does not give — that returns the
   * kernel version ("25.6.0"). Both are kept: one for display, one for diagnostics. */
  osVersion: string;
  osRelease: string;
  dataPath: string;
  databasePath: string;
}

export interface AppStorageInfo {
  knowledgeFileCount: number;
  knowledgeBytes: number;
  databaseBytes: number;
  cacheBytes: number;
}

export interface AppStats {
  /** Every row in `messages` — user and assistant alike, written by ipc/agent.ts on each run. */
  messageCount: number;
}

/** Size of one file, or 0 if it is missing or unreadable. A knowledge file deleted from
 * under the app, or an absent WAL sidecar, must not fail the whole storage lookup. */
async function fileSize(filePath: string): Promise<number> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile() ? stats.size : 0;
  } catch {
    return 0;
  }
}

/** Counted from disk rather than the knowledge_files table, which has no size column. */
async function readKnowledgeUsage(): Promise<{ count: number; bytes: number }> {
  const directory = getKnowledgeFilesDir();
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return { count: 0, bytes: 0 };
  }
  const files = entries.filter((entry) => entry.isFile());
  const sizes = await Promise.all(files.map((entry) => fileSize(path.join(directory, entry.name))));
  return { count: files.length, bytes: sizes.reduce((total, size) => total + size, 0) };
}

async function readDatabaseBytes(): Promise<number> {
  const base = path.join(getDatabaseDir(), DATABASE_FILE);
  const sizes = await Promise.all(DATABASE_SIDECARS.map((suffix) => fileSize(`${base}${suffix}`)));
  return sizes.reduce((total, size) => total + size, 0);
}

export function registerAppInfoHandlers() {
  ipcMain.handle(
    "app:info",
    (): AppInfo => ({
      name: app.getName(),
      packageVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      platform: os.platform(),
      arch: os.arch(),
      osVersion: process.getSystemVersion(),
      osRelease: os.release(),
      dataPath: app.getPath("userData"),
      databasePath: path.join(getDatabaseDir(), DATABASE_FILE),
    })
  );

  ipcMain.handle("app:storageInfo", async (): Promise<AppStorageInfo> => {
    const [knowledge, databaseBytes, cacheBytes] = await Promise.all([
      readKnowledgeUsage(),
      readDatabaseBytes(),
      session.defaultSession.getCacheSize(),
    ]);
    return {
      knowledgeFileCount: knowledge.count,
      knowledgeBytes: knowledge.bytes,
      databaseBytes,
      cacheBytes,
    };
  });

  ipcMain.handle("app:stats", (): AppStats => {
    const row = getDb().prepare("SELECT COUNT(*) AS count FROM messages").get() as { count: number };
    return { messageCount: row.count };
  });

  // Chromium's HTTP cache only. This deletes no file the app owns and cannot reach userData
  // — deliberately not `fs.rm(app.getPath("cache"))`, which is the *user's* whole cache root
  // (~/Library/Caches, %LOCALAPPDATA%, ~/.cache), not this app's.
  ipcMain.handle("app:clearCache", async (): Promise<number> => {
    await session.defaultSession.clearCache();
    return session.defaultSession.getCacheSize();
  });
}
