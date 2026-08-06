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

vi.mock("../db/settingsStore", () => ({
  getSetting: vi.fn((_name: string, defaultValue: string) => defaultValue),
}));

import { suggestAgentIdentity, AgentIdentitySuggestError } from "./agentIdentitySuggest";

describe("suggestAgentIdentity", () => {
  it("parses a clean JSON completion into name/tagline", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"name": "Fareway", "tagline": "Flight Price Tracking"}' } }],
    });

    const result = await suggestAgentIdentity("Tracks flight prices and alerts on drops");
    expect(result).toEqual({ name: "Fareway", tagline: "Flight Price Tracking" });

    const requestArgs = createMock.mock.calls[0][0];
    const userMessage = requestArgs.messages.find((m: { role: string }) => m.role === "user").content;
    expect(userMessage).toBe("Tracks flight prices and alerts on drops");
    const systemMessage = requestArgs.messages.find((m: { role: string }) => m.role === "system").content;
    expect(systemMessage).toMatch(/3 to 4 words/i);
  });

  it("bounds the request with a client-side timeout (KI-13)", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '{"name": "Scout", "tagline": "Web Research"}' } }] });
    await suggestAgentIdentity("context");
    const requestOptions = createMock.mock.calls[0][1];
    expect(requestOptions).toEqual({ timeout: expect.any(Number) });
    expect(requestOptions.timeout).toBeGreaterThan(0);
  });

  it("strips a markdown fence the model added despite being told not to", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '```json\n{"name": "Scout", "tagline": "Web Research Helper"}\n```' } }],
    });

    const result = await suggestAgentIdentity("Researches topics on the web");
    expect(result).toEqual({ name: "Scout", tagline: "Web Research Helper" });
  });

  it("trims whitespace around the returned name and tagline", async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: '{"name": " Scout ", "tagline": " Web Research "}' } }],
    });

    const result = await suggestAgentIdentity("context");
    expect(result).toEqual({ name: "Scout", tagline: "Web Research" });
  });

  it("throws AgentIdentitySuggestError on unparseable output", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: "not json at all" } }] });
    await expect(suggestAgentIdentity("context")).rejects.toBeInstanceOf(AgentIdentitySuggestError);
  });

  it("throws AgentIdentitySuggestError when a field is missing or blank", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '{"name": "Scout", "tagline": ""}' } }] });
    await expect(suggestAgentIdentity("context")).rejects.toBeInstanceOf(AgentIdentitySuggestError);
  });

  it("throws AgentIdentitySuggestError when the completion has no content at all", async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: {} }] });
    await expect(suggestAgentIdentity("context")).rejects.toBeInstanceOf(AgentIdentitySuggestError);
  });
});
