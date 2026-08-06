import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempUserDataDir: string;

vi.mock("../../appDirs", () => ({
  getUserInfoDir: () => path.join(tempUserDataDir, "user-info"),
}));

import {
  askUser,
  askUserParams,
  normalizeAskUserField,
  NO_ANSWER_TIMEOUT_SENTINEL,
  ASK_USER_CANCELLED_SENTINEL,
  type AskUserField,
} from "./askUserTools";
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

  // KI-4's invariant moved out of the schema and into normalizeAskUserField (see its own
  // comment): a placeholder the agent didn't offer must never reach the user, but rejecting
  // the whole call over it cost a real agent-creation flow in manual testing. The schema now
  // accepts the near-miss; the normalizer is what enforces the guarantee.
  it("accepts a single_select placeholder that isn't one of its own options, leaving it to the normalizer", () => {
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
    expect(result.success).toBe(true);
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

describe("normalizeAskUserField (KI-4's guarantee, enforced without rejecting the call)", () => {
  const options = [
    { label: "Beginner", value: "beginner" },
    { label: "Intermediate", value: "intermediate" },
    { label: "Advanced", value: "advanced" },
  ];
  const select = (placeholder?: string): AskUserField => ({
    type: "single_select",
    options,
    ...(placeholder === undefined ? {} : { placeholder }),
    required: false,
  });

  // The exact call that failed twice in manual testing and killed the agent-creation flow.
  it("maps an option's label back to its value", () => {
    expect(normalizeAskUserField(select("Beginner"))).toMatchObject({ placeholder: "beginner" });
  });

  it("leaves a correct value alone", () => {
    expect(normalizeAskUserField(select("advanced"))).toMatchObject({ placeholder: "advanced" });
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    expect(normalizeAskUserField(select("  INTERMEDIATE "))).toMatchObject({ placeholder: "intermediate" });
  });

  it("drops a placeholder matching neither a value nor a label, rather than offering it", () => {
    const normalized = normalizeAskUserField(select("expert"));
    expect(normalized).not.toHaveProperty("placeholder");
  });

  it("keeps the options untouched while normalizing", () => {
    expect(normalizeAskUserField(select("Beginner"))).toMatchObject({ options });
  });

  it("leaves a single_select with no placeholder alone", () => {
    expect(normalizeAskUserField(select())).toEqual(select());
  });

  it("leaves a text field alone, placeholder and all", () => {
    const field: AskUserField = { type: "text", placeholder: "anything at all", required: false };
    expect(normalizeAskUserField(field)).toEqual(field);
  });
});

describe("askUser passes the normalized field to requestAnswer", () => {
  it("hands the renderer the option's value, not the label the model sent", async () => {
    const requestAnswer = vi.fn().mockResolvedValue("beginner");
    await askUser(
      {
        question: "What's your fitness level?",
        field: {
          type: "single_select",
          options: [
            { label: "Beginner", value: "beginner" },
            { label: "Advanced", value: "advanced" },
          ],
          placeholder: "Beginner",
          required: false,
        },
      },
      "Cipher",
      requestAnswer
    );
    expect(requestAnswer).toHaveBeenCalledWith(
      "Cipher",
      "What's your fitness level?",
      expect.objectContaining({ placeholder: "beginner" })
    );
  });
});

describe("the call that failed in manual testing (verbatim from debug.log)", () => {
  // Rejected twice by the old schema-level refine as "InvalidToolInputError: Invalid JSON
  // input for tool", after which Cipher abandoned ask_user and typed the question as plain
  // text — losing the whole Fitness Coach creation flow to a capital B.
  const payload = {
    question: "What is your current fitness level or experience (e.g., beginner, intermediate, advanced)?",
    field: {
      type: "single_select",
      options: [
        { label: "Beginner", value: "beginner" },
        { label: "Intermediate", value: "intermediate" },
        { label: "Advanced", value: "advanced" },
      ],
      placeholder: "Beginner",
      required: true,
    },
    rememberAsUserInfo: true,
  };

  it("now validates instead of throwing", () => {
    expect(askUserParams.safeParse(payload).success).toBe(true);
  });

  it("reaches the user with the placeholder repaired to a real option value", () => {
    const parsed = askUserParams.parse(payload);
    expect(normalizeAskUserField(parsed.field)).toMatchObject({ placeholder: "beginner" });
  });
});
