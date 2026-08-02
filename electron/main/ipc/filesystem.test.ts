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
import { registerFilesystemHandlers } from "./filesystem";

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

  it("allows reading a file inside an allowed root", async () => {
    const filePath = path.join(allowedDir, "note.txt");
    writeFileSync(filePath, "hello");

    const content = await handlers["fs:readFile"](null, filePath);
    expect(content).toBe("hello");
  });

  it("extracts plain text from an .html file inside an allowed root instead of returning raw markup", async () => {
    const filePath = path.join(allowedDir, "page.html");
    writeFileSync(filePath, "<html><body><h1>Title</h1><p>Body text</p></body></html>");

    const content = await handlers["fs:readFile"](null, filePath);
    expect(content).toBe("Title\nBody text");
  });

  it("denies reading a file outside all allowed roots", async () => {
    const filePath = path.join(outsideDir, "secret.txt");
    writeFileSync(filePath, "nope");

    await expect(handlers["fs:readFile"](null, filePath)).rejects.toThrow("Access denied");
  });

  it("denies a path that escapes the allowed root via ../ traversal", async () => {
    const traversal = path.join(allowedDir, "..", "outside", "secret.txt");
    writeFileSync(path.join(outsideDir, "secret.txt"), "nope");

    await expect(handlers["fs:readFile"](null, traversal)).rejects.toThrow("Access denied");
  });

  it("denies a symlink inside the allowed root that points outside it", async () => {
    const targetFile = path.join(outsideDir, "secret.txt");
    writeFileSync(targetFile, "nope");
    const linkPath = path.join(allowedDir, "escape-link");
    symlinkSync(targetFile, linkPath);

    await expect(handlers["fs:readFile"](null, linkPath)).rejects.toThrow("Access denied");
  });

  it("allows writing a new file inside the allowed root", async () => {
    const filePath = path.join(allowedDir, "new-file.txt");
    await handlers["fs:writeFile"](null, filePath, "content");
    expect(await handlers["fs:readFile"](null, filePath)).toBe("content");
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
