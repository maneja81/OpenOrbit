import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("../../db/settingsStore", () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

import { getSetting } from "../../db/settingsStore";
import { listGrantedFolders, listFolderContents, readFolderFileContent } from "./folderAccessTools";

describe("folder-access agent tools", () => {
  let tmpRoot: string;
  let allowedDir: string;
  let outsideDir: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "agents-folder-tools-test-"));
    allowedDir = path.join(tmpRoot, "allowed");
    outsideDir = path.join(tmpRoot, "outside");
    mkdirSync(allowedDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    vi.mocked(getSetting).mockReturnValue([allowedDir]);
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("list_granted_folders returns the allowed roots", async () => {
    const result = await listGrantedFolders();
    expect(result).toEqual({ total: 1, folders: [allowedDir] });
  });

  it("list_folder_contents lists entries inside a granted folder", async () => {
    writeFileSync(path.join(allowedDir, "note.txt"), "hello");
    mkdirSync(path.join(allowedDir, "sub"));

    const result = await listFolderContents({ path: allowedDir });

    expect(result.total).toBe(2);
    expect(result.entries.map((e) => e.name).sort()).toEqual(["note.txt", "sub"]);
  });

  it("list_folder_contents denies a path outside all granted folders", async () => {
    await expect(listFolderContents({ path: outsideDir })).rejects.toThrow("Access denied");
  });

  it("read_folder_file reads a file inside a granted folder", async () => {
    const filePath = path.join(allowedDir, "note.txt");
    writeFileSync(filePath, "hello world");

    const result = await readFolderFileContent({ path: filePath });
    expect(result).toEqual({ path: filePath, content: "hello world" });
  });

  it("read_folder_file denies a file outside all granted folders", async () => {
    const filePath = path.join(outsideDir, "secret.txt");
    writeFileSync(filePath, "nope");

    await expect(readFolderFileContent({ path: filePath })).rejects.toThrow("Access denied");
  });
});
