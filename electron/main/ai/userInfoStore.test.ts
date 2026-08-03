import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

let tempUserDataDir: string;

vi.mock("../appDirs", () => ({
  getUserInfoDir: () => path.join(tempUserDataDir, "user-info"),
}));

import {
  appendUserInfoFact,
  formatUserInfoForPrompt,
  readUserInfoFacts,
  removeUserInfoFact,
  upsertUserInfoFact,
} from "./userInfoStore";

describe("userInfoStore", () => {
  beforeEach(() => {
    tempUserDataDir = mkdtempSync(path.join(tmpdir(), "user-info-test-"));
  });

  afterEach(() => {
    rmSync(tempUserDataDir, { recursive: true, force: true });
  });

  it("returns an empty array when no facts file exists yet", () => {
    expect(readUserInfoFacts()).toEqual([]);
  });

  it("appends and reads back a fact, round-trip", () => {
    appendUserInfoFact({ question: "What's your role?", answer: "Product manager", askedBy: "configAgent" });
    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ question: "What's your role?", answer: "Product manager", askedBy: "configAgent" });
    expect(typeof facts[0].createdAt).toBe("string");
  });

  it("caps stored facts at 50, keeping the most recent ones", () => {
    for (let i = 0; i < 55; i++) {
      appendUserInfoFact({ question: `Q${i}`, answer: `A${i}`, askedBy: "configAgent" });
    }
    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(50);
    expect(facts[0].question).toBe("Q5");
    expect(facts[facts.length - 1].question).toBe("Q54");
  });

  it("upsert replaces the answer to a question instead of stacking a second one", () => {
    // Settings → About you re-answers the same fixed questions, and a Danger Zone reset
    // leaves this file on disk while clearing onboardingDone — appending would put two
    // contradicting answers into every agent's prompt.
    upsertUserInfoFact({ question: "How technical are you?", answer: "Beginner", askedBy: "onboarding" });
    upsertUserInfoFact({ question: "How technical are you?", answer: "Expert", askedBy: "settings" });

    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ answer: "Expert", askedBy: "settings" });
  });

  it("upsert appends when the question has no stored answer yet", () => {
    upsertUserInfoFact({ question: "What is your profession?", answer: "Designer", askedBy: "onboarding" });
    upsertUserInfoFact({ question: "How technical are you?", answer: "Expert", askedBy: "onboarding" });

    expect(readUserInfoFacts().map((fact) => fact.question)).toEqual([
      "What is your profession?",
      "How technical are you?",
    ]);
  });

  it("upsert collapses duplicates left by the earlier append-only behaviour", () => {
    appendUserInfoFact({ question: "How technical are you?", answer: "Beginner", askedBy: "onboarding" });
    appendUserInfoFact({ question: "How technical are you?", answer: "Intermediate", askedBy: "onboarding" });

    upsertUserInfoFact({ question: "How technical are you?", answer: "Expert", askedBy: "settings" });

    const facts = readUserInfoFacts();
    expect(facts).toHaveLength(1);
    expect(facts[0].answer).toBe("Expert");
  });

  it("remove drops every fact for a question and leaves the others", () => {
    upsertUserInfoFact({ question: "What is your profession?", answer: "Designer", askedBy: "onboarding" });
    upsertUserInfoFact({ question: "How technical are you?", answer: "Expert", askedBy: "onboarding" });

    removeUserInfoFact("How technical are you?");

    expect(readUserInfoFacts().map((fact) => fact.question)).toEqual(["What is your profession?"]);
  });

  it("remove is a no-op for a question that was never stored", () => {
    upsertUserInfoFact({ question: "What is your profession?", answer: "Designer", askedBy: "onboarding" });

    removeUserInfoFact("Never asked");

    expect(readUserInfoFacts()).toHaveLength(1);
  });

  it("formatUserInfoForPrompt returns empty string for no facts", () => {
    expect(formatUserInfoForPrompt([])).toBe("");
  });

  it("formatUserInfoForPrompt renders a bullet list for populated facts", () => {
    const block = formatUserInfoForPrompt([
      { question: "What's your role?", answer: "Product manager", askedBy: "configAgent", createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(block).toContain("What's your role? → Product manager");
  });
});
