import { dialog, ipcMain, BrowserWindow, shell } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "../db/settingsStore";
import { getKnowledgeFilesDir } from "../appDirs";
import { isHttpUrl } from "../security/externalUrl";
import { DOCUMENT_EXTRACTORS, extractDocumentText } from "../ai/documentExtract";

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export function getAllowedRoots(): string[] {
  return getSetting<string[]>("allowedRoots", []);
}

/** Revokes access to `root` and returns the remaining roots. Pure function (no ipcMain) so the
 * knowledge base can revoke a granted folder when its row is removed, as well as the
 * fs:removeAllowedRoot IPC handler below — allowedRoots stays the single source of truth for
 * what assertAllowed will permit, whichever surface the user removed the folder from. */
export function removeAllowedRoot(root: string): string[] {
  const roots = getAllowedRoots();
  setSetting(
    "allowedRoots",
    roots.filter((r) => r !== root)
  );
  return getAllowedRoots();
}

/** Resolves symlinks for `target`. If it doesn't exist yet (e.g. a file about to be created),
 * resolves symlinks on the nearest existing ancestor directory instead. */
async function realpathOrNearestExisting(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await fs.realpath(resolved);
  } catch {
    const parent = path.dirname(resolved);
    if (parent === resolved) throw new Error(`Cannot resolve path: "${target}"`);
    const realParent = await realpathOrNearestExisting(parent);
    return path.join(realParent, path.basename(resolved));
  }
}

/** Resolves and confirms `target` (following symlinks) is inside, or equal to, one of the
 * allowed roots (also symlink-resolved). Throws if not. Returns the real, safe-to-use path. */
export async function assertAllowed(target: string): Promise<string> {
  const real = await realpathOrNearestExisting(target);
  const roots = getAllowedRoots();
  const realRoots = await Promise.all(
    roots.map((root) => fs.realpath(path.resolve(root)).catch(() => null))
  );
  const ok = realRoots.some((realRoot) => {
    if (!realRoot) return false;
    const rel = path.relative(realRoot, real);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
  if (!ok) {
    throw new Error(`Access denied: "${real}" is outside all allowed folders`);
  }
  return real;
}

/** Lists the entries of a directory inside an allowed root. Pure function (no ipcMain) so
 * it can be called directly from an in-process agent tool as well as from the fs:readDir
 * IPC handler below — both funnel through the same assertAllowed() guard. */
export async function listFolderEntries(dirPath: string): Promise<FsEntry[]> {
  const resolved = await assertAllowed(dirPath);
  const entries = await fs.readdir(resolved, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    path: path.join(resolved, entry.name),
    isDirectory: entry.isDirectory(),
  }));
}

/** Reads a file inside an allowed root. Pure function (no ipcMain) so it can be called
 * directly from an in-process agent tool as well as from the fs:readFile IPC handler below.
 * Binary document formats (PDF, Word, Excel, PowerPoint, OpenDocument, HTML — see
 * ai/documentExtract.ts, the same pipeline the Knowledgebase feature uses) are parsed into
 * plain text; anything else is decoded as UTF-8 as before. */
export async function readFolderFile(filePath: string): Promise<string> {
  const resolved = await assertAllowed(filePath);
  const ext = path.extname(resolved).toLowerCase();
  const buf = await fs.readFile(resolved);
  if (ext in DOCUMENT_EXTRACTORS) {
    return extractDocumentText(buf, ext);
  }
  return buf.toString("utf-8");
}

export function registerFilesystemHandlers() {
  ipcMain.handle("fs:pickFolder", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;

    const chosen = result.filePaths[0];
    const roots = getAllowedRoots();
    if (!roots.includes(chosen)) {
      setSetting("allowedRoots", [...roots, chosen]);
    }
    return chosen;
  });

  // fs:readDir backs the knowledge base's folder browser (see useFolderBrowse) — one level per
  // call, never recursive. listFolderEntries/readFolderFile/getAllowedRoots/removeAllowedRoot
  // above are also called directly, in-process, by the folder-access agent tools (see
  // ai/tools/folderAccessTools.ts) and the knowledge base — that in-process use is why the
  // functions stay even though their renderer-facing IPC handlers (fs:readFile, fs:writeFile,
  // fs:listAllowedRoots, fs:removeAllowedRoot) were removed as unreachable dead surface: no
  // hook or component ever called them (KI-16), and fs:writeFile in particular could write
  // arbitrary content to any path inside a granted root from any renderer script.
  ipcMain.handle("fs:readDir", (_event, dirPath: string): Promise<FsEntry[]> => listFolderEntries(dirPath));

  // Knowledge-base files live in app-owned storage (see knowledgeBase.ts's
  // copyIntoStorage), not a user-allowlisted root — assertAllowed doesn't apply here.
  // showItemInFolder is a read-only OS action (opens the file manager, no data returned).
  // Every caller passes a path the main process itself produced — a knowledge-base row's
  // stored path, or the userData/database paths app:info reports (see ipc/appInfo.ts) —
  // never a path the renderer composed.
  ipcMain.handle("fs:revealInFolder", (_event, filePath: string): void => {
    shell.showItemInFolder(filePath);
  });

  // Unlike fs:revealInFolder (inert — just highlights a file in Finder), shell.openPath
  // launches the OS default handler for the target, which can execute code for
  // executables/scripts/app bundles. So, unlike revealInFolder, this IS gated — restricted
  // to the app-owned knowledge-files directory, since that's the only source that calls it
  // today (KnowledgeModal's click-to-open) and it keeps the IPC surface from accepting an
  // arbitrary renderer-supplied path. shell.openPath resolves with an error string on
  // failure (e.g. no app associated) and an empty string on success.
  ipcMain.handle("fs:openPath", async (_event, filePath: string): Promise<void> => {
    const real = await realpathOrNearestExisting(filePath);
    const kbDir = await fs.realpath(getKnowledgeFilesDir()).catch(() => null);
    const rel = kbDir ? path.relative(kbDir, real) : null;
    const inKbDir = kbDir !== null && rel !== null && (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)));
    if (!inKbDir) {
      throw new Error(`Access denied: "${real}" is outside the knowledge base storage folder`);
    }
    const result = await shell.openPath(real);
    if (result) throw new Error(result);
  });

  // Renderer-triggered "open in browser" for a knowledge-base row's source URL —
  // restricted to http(s) so this can't be used to open a local file:// path or a
  // custom URL scheme registered by another app.
  ipcMain.handle("fs:openExternal", async (_event, url: string): Promise<void> => {
    if (typeof url !== "string") throw new Error("fs:openExternal requires a URL");
    try {
      new URL(url);
    } catch {
      throw new Error(`"${url}" is not a valid URL`);
    }
    // Scheme policy lives in security/externalUrl.ts so this handler and
    // setWindowOpenHandler cannot drift apart. The "not a valid URL" case stays distinct
    // above because src/lib/appLinks.ts documents both messages.
    if (!isHttpUrl(url)) {
      throw new Error(`Refusing to open non-http(s) URL: "${url}"`);
    }
    await shell.openExternal(url);
  });
}
