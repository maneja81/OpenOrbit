import { describe, expect, it, vi } from "vitest";

const createMock = vi.fn();

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: createMock } };
  },
}));

vi.mock("./provider", () => ({
  getDecryptedChatApiKey: () => "test-key",
  getConfiguredChatUrl: () => "https://api.openai.com/v1",
}));

let orchestratorModel: string | undefined;

vi.mock("../db/settingsStore", () => ({
  getSetting: vi.fn((_name: string, defaultValue: string) => orchestratorModel ?? defaultValue),
}));

import { distillSkillContents } from "./skillDistill";

describe("distillSkillContents", () => {
  it("sends branding-stripping/dedup instructions and all sources, returns the completion text", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "  merged key points  " } }] });

    const result = await distillSkillContents(
      [
        { owner: "benminer", repo: "openclaw-budget-skill", rawMarkdown: "budget source content" },
        { owner: "cjpatten", repo: "canadian-finance-planner-skill", rawMarkdown: "finance source content" },
      ],
      "personal budget tracking"
    );

    expect(result).toBe("merged key points");

    const requestArgs = createMock.mock.calls[0][0];
    const systemMessage = requestArgs.messages.find((m: { role: string }) => m.role === "system").content;
    expect(systemMessage).toMatch(/branding/i);
    expect(systemMessage).toMatch(/duplicate/i);
    expect(systemMessage).toMatch(/shell or script-execution/i);

    const userMessage = requestArgs.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMessage).toContain("budget source content");
    expect(userMessage).toContain("finance source content");
    expect(userMessage).toContain("personal budget tracking");
  });

  it("returns an empty string if the completion has no content", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: {} }] });
    const result = await distillSkillContents([{ owner: "a", repo: "b", rawMarkdown: "x" }], "query");
    expect(result).toBe("");
  });

  it("uses the user's currently configured orchestrator model rather than a hardcoded one", async () => {
    createMock.mockClear();
    orchestratorModel = "gpt-4o-mini";
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "x" } }] });
    await distillSkillContents([{ owner: "a", repo: "b", rawMarkdown: "x" }], "query");
    expect(createMock.mock.calls[0][0].model).toBe("gpt-4o-mini");
    orchestratorModel = undefined;
  });

  it("falls back to the default model when no orchestratorModel setting is stored", async () => {
    createMock.mockClear();
    orchestratorModel = undefined;
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "x" } }] });
    await distillSkillContents([{ owner: "a", repo: "b", rawMarkdown: "x" }], "query");
    expect(createMock.mock.calls[0][0].model).toBe("gpt-4.1-mini");
  });
});
