import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempUserDataDir: string;

vi.mock("../../appDirs", () => ({
  getUserInfoDir: () => path.join(tempUserDataDir, "user-info"),
}));

import { saveUserInfo, saveUserInfoParams } from "./userInfoTools";
import { readUserInfoFacts } from "../userInfoStore";

describe("save_user_info parameter limits", () => {
  beforeEach(() => {
    tempUserDataDir = mkdtempSync(path.join(tmpdir(), "user-info-tool-test-"));
  });

  afterEach(() => {
    rmSync(tempUserDataDir, { recursive: true, force: true });
  });

  it("rejects an answer longer than the max length, so one long fact can't bloat every agent's prompt", () => {
    const result = saveUserInfoParams.safeParse({ question: "What's your job?", answer: "x".repeat(501) });
    expect(result.success).toBe(false);
  });

  it("accepts and stores a normal-length fact, recording which agent asked", async () => {
    const result = await saveUserInfo({ question: "What's your job?", answer: "Product manager" }, "configAgent");
    expect(result).toBe("Saved.");
    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].askedBy).toBe("configAgent");
  });

  it("records a different agent's name when a different agent calls it", async () => {
    await saveUserInfo({ question: "Birth date?", answer: "1990-01-01" }, "Astrologer");
    const facts = readUserInfoFacts();
    expect(facts[0].askedBy).toBe("Astrologer");
  });
});
