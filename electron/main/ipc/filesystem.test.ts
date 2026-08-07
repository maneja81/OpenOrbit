import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn() },
  shell: { showItemInFolder: vi.fn(), openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock("../db/settingsStore", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

let knowledgeFilesDir = "";
vi.mock("../appDirs", () => ({
  getKnowledgeFilesDir: () => knowledgeFilesDir,
}));

import { ipcMain, shell } from "electron";
import { getSetting } from "../db/settingsStore";
import { readFolderFile, registerFilesystemHandlers } from "./filesystem";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function getHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  for (const call of (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls) {
    handlers[call[0] as string] = call[1] as Handler;
  }
  return handlers;
}

describe("filesystem IPC allowlist (assertAllowed)", () => {
  let tmpRoot: string;
  let allowedDir: string;
  let outsideDir: string;
  let kbDir: string;
  let handlers: Record<string, Handler>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "agents-fs-test-"));
    allowedDir = path.join(tmpRoot, "allowed");
    outsideDir = path.join(tmpRoot, "outside");
    kbDir = path.join(tmpRoot, "knowledge-files");
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(kbDir, { recursive: true });
    knowledgeFilesDir = kbDir;

    vi.mocked(getSetting).mockReturnValue([allowedDir]);
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(shell.showItemInFolder).mockClear();
    vi.mocked(shell.openExternal).mockClear();
    vi.mocked(shell.openPath).mockClear();
    registerFilesystemHandlers();
    handlers = getHandlers();
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  // fs:readFile and fs:writeFile were removed as unreachable renderer surface (KI-16) — no
  // hook or component ever called them, and fs:writeFile in particular could write
  // arbitrary content to any path inside a granted root from any renderer script.
  // readFolderFile/assertAllowed stay in-process, used directly by the folder-access agent
  // tools (see ai/tools/folderAccessTools.ts), so the access-control guarantees below are
  // exercised through that same exported function rather than a removed IPC handler.
  it("allows reading a file inside an allowed root", async () => {
    const filePath = path.join(allowedDir, "note.txt");
    writeFileSync(filePath, "hello");

    const content = await readFolderFile(filePath);
    expect(content).toBe("hello");
  });

  it("extracts plain text from an .html file inside an allowed root instead of returning raw markup", async () => {
    const filePath = path.join(allowedDir, "page.html");
    writeFileSync(filePath, "<html><body><h1>Title</h1><p>Body text</p></body></html>");

    const content = await readFolderFile(filePath);
    expect(content).toBe("Title\nBody text");
  });

  it("denies reading a file outside all allowed roots", async () => {
    const filePath = path.join(outsideDir, "secret.txt");
    writeFileSync(filePath, "nope");

    await expect(readFolderFile(filePath)).rejects.toThrow("Access denied");
  });

  it("denies a path that escapes the allowed root via ../ traversal", async () => {
    const traversal = path.join(allowedDir, "..", "outside", "secret.txt");
    writeFileSync(path.join(outsideDir, "secret.txt"), "nope");

    await expect(readFolderFile(traversal)).rejects.toThrow("Access denied");
  });

  it("rejects a relative path instead of silently resolving it against process.cwd()", async () => {
    // Regression: a relative path like "open-orbit-workspace" used to resolve via
    // path.resolve() against process.cwd() (the Electron main process cwd), landing
    // outside every granted root and throwing a misleading "outside all allowed
    // folders" error instead of a clear "must be absolute" one.
    await expect(readFolderFile("note.txt")).rejects.toThrow("Path must be absolute");
  });

  it("denies a symlink inside the allowed root that points outside it", async () => {
    const targetFile = path.join(outsideDir, "secret.txt");
    writeFileSync(targetFile, "nope");
    const linkPath = path.join(allowedDir, "escape-link");
    symlinkSync(targetFile, linkPath);

    await expect(readFolderFile(linkPath)).rejects.toThrow("Access denied");
  });

  it("reveals a file inside an allowed root via shell.showItemInFolder", async () => {
    const filePath = path.join(allowedDir, "note.txt");
    writeFileSync(filePath, "hello");
    const { shell } = await import("electron");

    await handlers["fs:revealInFolder"](null, filePath);

    expect(shell.showItemInFolder).toHaveBeenCalledWith(filePath);
  });

  it("opens an http(s) URL via shell.openExternal", async () => {
    const { shell } = await import("electron");

    await handlers["fs:openExternal"](null, "https://example.com/docs");

    expect(shell.openExternal).toHaveBeenCalledWith("https://example.com/docs");
  });

  it("rejects a non-http(s) URL without calling shell.openExternal", async () => {
    const { shell } = await import("electron");

    await expect(handlers["fs:openExternal"](null, "file:///etc/passwd")).rejects.toThrow(
      'Refusing to open non-http(s) URL: "file:///etc/passwd"'
    );
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("rejects an unparseable URL", async () => {
    await expect(handlers["fs:openExternal"](null, "not a url")).rejects.toThrow('"not a url" is not a valid URL');
  });

  it("opens a file inside the knowledge base folder via shell.openPath", async () => {
    const filePath = path.join(kbDir, "doc.pdf");
    writeFileSync(filePath, "content");
    vi.mocked(shell.openPath).mockResolvedValue("");

    await handlers["fs:openPath"](null, filePath);

    expect(shell.openPath).toHaveBeenCalledTimes(1);
    const [calledPath] = vi.mocked(shell.openPath).mock.calls[0];
    expect(path.basename(calledPath as string)).toBe("doc.pdf");
  });

  it("rejects fs:openPath when shell.openPath returns a non-empty error string", async () => {
    const filePath = path.join(kbDir, "doc.pdf");
    writeFileSync(filePath, "content");
    vi.mocked(shell.openPath).mockResolvedValue("no application associated");

    await expect(handlers["fs:openPath"](null, filePath)).rejects.toThrow("no application associated");
  });

  it("denies fs:openPath for a file outside the knowledge base folder", async () => {
    const filePath = path.join(outsideDir, "secret.exe");
    writeFileSync(filePath, "content");

    await expect(handlers["fs:openPath"](null, filePath)).rejects.toThrow("Access denied");
    expect(shell.openPath).not.toHaveBeenCalled();
  });

  it("denies fs:openPath for a symlink inside the knowledge base folder that points outside it", async () => {
    const targetFile = path.join(outsideDir, "secret.exe");
    writeFileSync(targetFile, "content");
    const linkPath = path.join(kbDir, "escape-link");
    symlinkSync(targetFile, linkPath);

    await expect(handlers["fs:openPath"](null, linkPath)).rejects.toThrow("Access denied");
    expect(shell.openPath).not.toHaveBeenCalled();
  });
});
