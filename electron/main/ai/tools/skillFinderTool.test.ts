import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempSkillsDir: string;

vi.mock("../../appDirs", () => ({
  getSkillsDir: () => tempSkillsDir,
}));

const { distillMock } = vi.hoisted(() => ({ distillMock: vi.fn() }));
vi.mock("../skillDistill", () => ({
  distillSkillContents: distillMock,
}));

import { distillOrFallback, saveRawSkill } from "./skillFinderTool";

describe("saveRawSkill", () => {
  beforeEach(() => {
    tempSkillsDir = mkdtempSync(path.join(tmpdir(), "skills-test-"));
  });

  afterEach(() => {
    rmSync(tempSkillsDir, { recursive: true, force: true });
  });

  it("writes the raw markdown verbatim under <skillsDir>/<owner>-<repo>/SKILL.md", async () => {
    const filePath = await saveRawSkill("benminer", "openclaw-budget-skill", "raw content");
    expect(readFileSync(filePath, "utf8")).toBe("raw content");
    expect(filePath).toBe(path.join(tempSkillsDir, "benminer-openclaw-budget-skill", "SKILL.md"));
  });

  it("rejects owner/repo values that don't look like real GitHub identifiers", async () => {
    await expect(saveRawSkill("../../etc", "passwd", "malicious")).rejects.toThrow(/unexpected repo identifier/);
    await expect(saveRawSkill("owner", "../../../escape", "malicious")).rejects.toThrow(/unexpected repo identifier/);
  });
});

describe("distillOrFallback", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns the distilled result on success", async () => {
    distillMock.mockResolvedValueOnce("merged key points");
    const result = await distillOrFallback([{ owner: "a", repo: "b", rawMarkdown: "x" }], "query");
    expect(result).toBe("merged key points");
  });

  it("falls back to truncated raw content when distillation throws, instead of losing the work", async () => {
    distillMock.mockRejectedValueOnce(new Error("no API key configured"));
    const longContent = "x".repeat(3000);
    const result = await distillOrFallback([{ owner: "benminer", repo: "openclaw-budget-skill", rawMarkdown: longContent }], "budget");

    expect(result).toContain("benminer/openclaw-budget-skill");
    expect(result).toContain("[...truncated]");
    expect(result.length).toBeLessThan(longContent.length);
  });

  it("does not truncate raw content shorter than the fallback cap", async () => {
    distillMock.mockRejectedValueOnce(new Error("network down"));
    const result = await distillOrFallback([{ owner: "a", repo: "b", rawMarkdown: "short content" }], "query");
    expect(result).toContain("short content");
    expect(result).not.toContain("[...truncated]");
  });
});
