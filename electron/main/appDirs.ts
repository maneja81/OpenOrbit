/**
 * App-owned data directories, all rooted under Electron's per-user `userData` path
 * (same root `agents.db` already lived in directly). Distinct from `allowedRoots` in
 * ipc/filesystem.ts, which is for folders the *user* grants the orchestrator read
 * access to — these are the app's own internal storage, not user project files.
 */

import { app } from "electron";
import { cpSync, existsSync, mkdirSync, renameSync, rmdirSync } from "node:fs";
import path from "node:path";
import { devLog } from "./devLog";

function root(): string {
  return app.getPath("userData");
}

/**
 * userData root before the "alex" -> "agents" package.json rename. Electron derives
 * userData from the app name, so the rename silently moved every app-owned directory
 * to a sibling folder; this points back at the original for one-time migration.
 */
export function getLegacyAppRoot(): string {
  return path.join(path.dirname(root()), "alex");
}

/**
 * Every userData root this app has used before the current one, newest-first. Electron
 * derives userData from the app name, so each rename ("alex" → "agents" → "OpenOrbit")
 * silently moved the app's own storage to a sibling folder — migrateLegacyUserData()
 * walks this list to bring an existing install's data across.
 *
 * Both casings of the pre-OpenOrbit name are listed because packaged builds take the name
 * from electron-builder's productName ("Agents") while dev builds take it from
 * package.json's name ("agents"), so the same machine can hold either.
 */
export function getLegacyAppRoots(): string[] {
  const current = root();
  return ["Agents", "agents", "alex"]
    .map((name) => path.join(path.dirname(current), name))
    .filter((candidate) => candidate !== current);
}

export function getMcpConfigDir(): string {
  return path.join(root(), "mcp");
}

export function getSkillsDir(): string {
  return path.join(root(), "skills");
}

/** Cross-agent-readable facts learned about the user during agent creation (see
 * ai/userInfoStore.ts) — distinct from appSettings (scalar config) and knowledge_files
 * (user-uploaded documents). */
export function getUserInfoDir(): string {
  return path.join(root(), "user-info");
}

export function getWorkflowsDir(): string {
  return path.join(root(), "workflows");
}

export function getDatabaseDir(): string {
  return path.join(root(), "database");
}

/** Files uploaded by the user, or created on their behalf by agent actions. */
export function getUserFilesDir(): string {
  return path.join(root(), "user");
}

/** Copies of files the user has added to the knowledge base (see ipc/knowledgeBase.ts). */
export function getKnowledgeFilesDir(): string {
  return path.join(root(), "knowledge-files");
}

/** Every app-owned directory, in one place so both ensureAppDirectories() and the rename
 * migration below stay in sync — a directory added here is created *and* migrated. */
function appDirectories(): string[] {
  return [
    getMcpConfigDir(),
    getSkillsDir(),
    getWorkflowsDir(),
    getDatabaseDir(),
    getUserFilesDir(),
    getKnowledgeFilesDir(),
    getUserInfoDir(),
  ];
}

/** Creates every app-owned directory if missing. Safe to call on every launch. */
export function ensureAppDirectories(): void {
  for (const dir of appDirectories()) {
    mkdirSync(dir, { recursive: true });
  }
}

function migrateDirectory(source: string, target: string): void {
  if (!existsSync(source)) return;
  if (existsSync(target)) {
    // Only an empty destination is safe to clear out of the way. rmdirSync throws on a
    // non-empty directory, so data already sitting at the new root can never be clobbered.
    rmdirSync(target);
  }
  try {
    renameSync(source, target);
  } catch {
    // Both roots are siblings under the same userData parent, so a cross-device rename
    // (EXDEV) shouldn't happen — fall back to copying rather than failing app launch.
    cpSync(source, target, { recursive: true });
  }
}

/**
 * Moves an existing install's app-owned directories from a previous userData root into the
 * current one after an app rename.
 *
 * Must run before ensureAppDirectories(), which would otherwise create empty directories
 * that block the move, and before any getDb() call: the database holds the key every stored
 * secret is encrypted with (see security/secretStorage.ts), so leaving it behind silently
 * turns every saved API key into an undecryptable blob.
 *
 * Deliberately never deletes the legacy root. A rename should not be the operation that
 * destroys a user's only copy of their data — a stale empty folder is the cheaper mistake.
 *
 * Runs on every launch rather than latching once the database has landed. migrateDirectory()
 * is already idempotent per directory — an absent source or a non-empty destination is a
 * no-op — and a global "the database is here, we're done" check would strand any directory
 * whose move failed the first time, since migration v31 rewrites knowledge_files.path to the
 * new root whether or not the files themselves made it across.
 */
export function migrateLegacyUserData(): void {
  const legacyRoot = getLegacyAppRoots().find((candidate) => existsSync(candidate));
  if (!legacyRoot) return;

  for (const target of appDirectories()) {
    const name = path.basename(target);
    try {
      migrateDirectory(path.join(legacyRoot, name), target);
    } catch (e) {
      // One directory failing — a non-empty destination, a permissions error — must not stop
      // the others from migrating or take down app launch.
      devLog(`[appDirs] could not migrate ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
