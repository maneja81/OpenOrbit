import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempUserDataDir: string;

vi.mock("../../appDirs", () => ({
  getUserInfoDir: () => path.join(tempUserDataDir, "user-info"),
}));

import { askUser, askUserParams, NO_ANSWER_TIMEOUT_SENTINEL, ASK_USER_CANCELLED_SENTINEL, type AskUserField } from "./askUserTools";
import { readUserInfoFacts } from "../userInfoStore";

const textField: AskUserField = { type: "text", required: true };

beforeEach(() => {
  tempUserDataDir = mkdtempSync(path.join(tmpdir(), "ask-user-tool-test-"));
});

afterEach(() => {
  rmSync(tempUserDataDir, { recursive: true, force: true });
});

describe("askUser (backs the ask_user tool)", () => {
  it("returns whatever requestAnswer resolves with", async () => {
    const requestAnswer = vi.fn().mockResolvedValue("Yes please");
    const answer = await askUser({ question: "Turn on background music?", field: textField }, "Cipher", requestAnswer);
    expect(answer).toBe("Yes please");
    expect(requestAnswer).toHaveBeenCalledWith("Cipher", "Turn on background music?", textField);
  });

  it("does not save to user info by default", async () => {
    const requestAnswer = vi.fn().mockResolvedValue("Product Designer");
    await askUser({ question: "What's your job?", field: textField }, "Cipher", requestAnswer);
    expect(readUserInfoFacts()).toHaveLength(0);
  });

  it("saves to user info when rememberAsUserInfo is true", async () => {
    const requestAnswer = vi.fn().mockResolvedValue("Product Designer");
    await askUser(
      { question: "What's your job?", field: textField, rememberAsUserInfo: true },
      "Cipher",
      requestAnswer
    );
    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ question: "What's your job?", answer: "Product Designer", askedBy: "Cipher" });
  });

  it("does not save a timed-out non-answer to user info even when rememberAsUserInfo is true", async () => {
    const requestAnswer = vi.fn().mockResolvedValue(NO_ANSWER_TIMEOUT_SENTINEL);
    await askUser(
      { question: "What's your job?", field: textField, rememberAsUserInfo: true },
      "Cipher",
      requestAnswer
    );
    expect(readUserInfoFacts()).toHaveLength(0);
  });

  it("does not save a cancelled non-answer to user info even when rememberAsUserInfo is true", async () => {
    const requestAnswer = vi.fn().mockResolvedValue(ASK_USER_CANCELLED_SENTINEL);
    await askUser(
      { question: "What's your job?", field: textField, rememberAsUserInfo: true },
      "Cipher",
      requestAnswer
    );
    expect(readUserInfoFacts()).toHaveLength(0);
  });

  it("records a different agent's name when a different agent calls it", async () => {
    const requestAnswer = vi.fn().mockResolvedValue("1990-01-01");
    await askUser(
      { question: "Birth date?", field: textField, rememberAsUserInfo: true },
      "Astrologer",
      requestAnswer
    );
    expect(readUserInfoFacts()[0].askedBy).toBe("Astrologer");
  });
});

describe("askUserParams schema", () => {
  it("accepts a well-formed text question", () => {
    const result = askUserParams.safeParse({
      question: "What's your monthly income?",
      field: { type: "text", required: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a well-formed single_select question", () => {
    const result = askUserParams.safeParse({
      question: "Which currency?",
      field: {
        type: "single_select",
        options: [
          { label: "US Dollar", value: "USD" },
          { label: "Euro", value: "EUR" },
        ],
        required: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a single_select with no options", () => {
    const result = askUserParams.safeParse({
      question: "Which currency?",
      field: { type: "single_select", options: [], required: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown field type", () => {
    const result = askUserParams.safeParse({
      question: "Pick a date",
      field: { type: "date", required: true },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a question over the length cap", () => {
    const result = askUserParams.safeParse({
      question: "x".repeat(301),
      field: { type: "text", required: true },
    });
    expect(result.success).toBe(false);
  });

  it("requires the `required` flag to be present", () => {
    const result = askUserParams.safeParse({
      question: "What's your job?",
      field: { type: "text" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single_select placeholder that isn't one of its own options (KI-4)", () => {
    const result = askUserParams.safeParse({
      question: "Which currency?",
      field: {
        type: "single_select",
        options: [
          { label: "US Dollar", value: "USD" },
          { label: "Euro", value: "EUR" },
        ],
        placeholder: "GBP",
        required: false,
      },
    });
    expect(result.success).toBe(false);
  });

  it("accepts a single_select placeholder that matches one of its own options", () => {
    const result = askUserParams.safeParse({
      question: "Which currency?",
      field: {
        type: "single_select",
        options: [
          { label: "US Dollar", value: "USD" },
          { label: "Euro", value: "EUR" },
        ],
        placeholder: "USD",
        required: false,
      },
    });
    expect(result.success).toBe(true);
  });
});
