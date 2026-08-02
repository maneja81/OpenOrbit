import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn() },
}));

vi.mock("../ai/userInfoStore", () => ({
  upsertUserInfoFact: vi.fn(),
  removeUserInfoFact: vi.fn(),
  readUserInfoFacts: vi.fn(() => []),
}));

vi.mock("../devLog", () => ({
  devLog: vi.fn(),
}));

import { ipcMain } from "electron";
import { readUserInfoFacts, removeUserInfoFact, upsertUserInfoFact } from "../ai/userInfoStore";
import { registerUserInfoHandlers } from "./userInfo";

type Handler = (event: unknown, ...args: unknown[]) => unknown;

function handlerFor(channel: string): Handler {
  registerUserInfoHandlers();
  const call = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === channel);
  if (!call) throw new Error(`${channel} was never registered`);
  return call[1] as Handler;
}

function seedFactsHandler(): Handler {
  return handlerFor("userInfo:seedFacts");
}

describe("userInfo:seedFacts", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(upsertUserInfoFact).mockClear();
    vi.mocked(removeUserInfoFact).mockClear();
    vi.mocked(readUserInfoFacts).mockClear();
  });

  it("upserts every valid fact, attributed to onboarding", () => {
    seedFactsHandler()(null, [
      { question: "What is your profession?", answer: "Product Designer" },
      { question: "How do you prefer responses?", answer: "Brief & direct" },
    ]);

    expect(upsertUserInfoFact).toHaveBeenCalledTimes(2);
    expect(upsertUserInfoFact).toHaveBeenNthCalledWith(1, {
      question: "What is your profession?",
      answer: "Product Designer",
      askedBy: "onboarding",
    });
    expect(upsertUserInfoFact).toHaveBeenNthCalledWith(2, {
      question: "How do you prefer responses?",
      answer: "Brief & direct",
      askedBy: "onboarding",
    });
  });

  it("ignores a non-array payload", () => {
    const handler = seedFactsHandler();
    handler(null, undefined);
    handler(null, { question: "q", answer: "a" });
    handler(null, "facts");

    expect(upsertUserInfoFact).not.toHaveBeenCalled();
  });

  it("skips malformed entries but keeps valid siblings", () => {
    seedFactsHandler()(null, [
      { question: "", answer: "Expert" },
      { question: "   ", answer: "Expert" },
      { question: "How technical are you?", answer: "" },
      { question: "How technical are you?", answer: "   " },
      { question: 42, answer: "Expert" },
      { question: "How technical are you?", answer: null },
      null,
      { question: "When stuck, what helps you most?", answer: "Give me options" },
    ]);

    expect(upsertUserInfoFact).toHaveBeenCalledTimes(1);
    expect(upsertUserInfoFact).toHaveBeenCalledWith({
      question: "When stuck, what helps you most?",
      answer: "Give me options",
      askedBy: "onboarding",
    });
  });
});

describe("userInfo:setFact", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(upsertUserInfoFact).mockClear();
    vi.mocked(removeUserInfoFact).mockClear();
  });

  it("saves an edited answer attributed to settings, trimmed", () => {
    handlerFor("userInfo:setFact")(null, "How technical are you?", "  Expert  ");

    expect(upsertUserInfoFact).toHaveBeenCalledWith({
      question: "How technical are you?",
      answer: "Expert",
      askedBy: "settings",
    });
    expect(removeUserInfoFact).not.toHaveBeenCalled();
  });

  it("clears the fact when the answer is blanked, rather than storing an empty one", () => {
    const handler = handlerFor("userInfo:setFact");
    handler(null, "How technical are you?", "");
    handler(null, "What is your profession?", "   ");

    expect(removeUserInfoFact).toHaveBeenNthCalledWith(1, "How technical are you?");
    expect(removeUserInfoFact).toHaveBeenNthCalledWith(2, "What is your profession?");
    expect(upsertUserInfoFact).not.toHaveBeenCalled();
  });

  it("ignores malformed question or answer arguments", () => {
    const handler = handlerFor("userInfo:setFact");
    handler(null, "", "Expert");
    handler(null, "   ", "Expert");
    handler(null, 42, "Expert");
    handler(null, "How technical are you?", null);
    handler(null, "How technical are you?", undefined);

    expect(upsertUserInfoFact).not.toHaveBeenCalled();
    expect(removeUserInfoFact).not.toHaveBeenCalled();
  });
});

describe("userInfo:list", () => {
  beforeEach(() => {
    vi.mocked(ipcMain.handle).mockClear();
    vi.mocked(readUserInfoFacts).mockClear();
  });

  it("returns the stored facts", () => {
    const stored = [
      { question: "How technical are you?", answer: "Expert", askedBy: "onboarding", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    vi.mocked(readUserInfoFacts).mockReturnValueOnce(stored);

    expect(handlerFor("userInfo:list")(null)).toEqual(stored);
  });
});
