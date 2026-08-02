/**
 * Folder-access tools — read-only access to the local folders the user has explicitly
 * granted via the Folders widget (fs:pickFolder / the `allowedRoots` setting).
 *
 * Three tools:
 *   list_granted_folders  — list the root folders the user has granted access to
 *   list_folder_contents  — list files/subfolders inside a granted folder
 *   read_folder_file      — read a file's content from inside a granted folder (text as-is,
 *                           PDF/Word/Excel/PowerPoint/HTML/OpenDocument parsed via ../documentExtract.ts)
 *
 * These call the same allowlist-guarded functions the fs:readDir/fs:readFile IPC handlers
 * use (electron/main/ipc/filesystem.ts) directly, in-process — not via ipcMain, since that
 * channel is for renderer→main, and these tools already run in the main process.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getAllowedRoots, listFolderEntries, readFolderFile } from "../../ipc/filesystem";

export async function listGrantedFolders() {
  const roots = getAllowedRoots();
  return { total: roots.length, folders: roots };
}

export async function listFolderContents({ path: dirPath }: { path: string }) {
  const entries = await listFolderEntries(dirPath);
  return { total: entries.length, entries };
}

export async function readFolderFileContent({ path: filePath }: { path: string }) {
  const content = await readFolderFile(filePath);
  return { path: filePath, content };
}

export const listGrantedFoldersTool = tool({
  name: "list_granted_folders",
  description:
    "List the root folders the user has explicitly granted access to via the Folders widget. Use this first to discover what's available before listing or reading files.",
  parameters: z.object({}),
  execute: listGrantedFolders,
});

export const listFolderContentsTool = tool({
  name: "list_folder_contents",
  description:
    "List the files and subfolders inside a path. The path must be one of the granted folders (see list_granted_folders) or a subdirectory of one — any other path is denied.",
  parameters: z.object({
    path: z.string().describe("Absolute path of the granted folder or subfolder to list."),
  }),
  execute: listFolderContents,
});

export const readFolderFileTool = tool({
  name: "read_folder_file",
  description:
    "Read the content of a file — plain text as well as PDF, Word (.doc/.docx), Excel (.xls/.xlsx), " +
    "PowerPoint (.pptx), HTML, and OpenDocument (.odt/.ods/.odp) files, parsed into plain text. The file " +
    "must be inside one of the granted folders (see list_granted_folders) — any other path is denied.",
  parameters: z.object({
    path: z.string().describe("Absolute path of the file to read."),
  }),
  execute: readFolderFileContent,
});
