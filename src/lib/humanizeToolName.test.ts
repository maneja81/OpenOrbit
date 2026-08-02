import { describe, expect, it } from "vitest";
import { humanizeToolName } from "./humanizeToolName";

describe("humanizeToolName", () => {
  it("maps a known tool id to its friendly label", () => {
    expect(humanizeToolName("web_search")).toBe("Web Search");
    expect(humanizeToolName("get_settings")).toBe("Get Settings");
  });

  it("shortens the orchestrator's history tool rather than title-casing its long id", () => {
    // Keyed on the registered id (electron/main/ai/tools/history.ts), not the
    // `searchHistoryTool` variable name. The short label matters: the activity feed
    // ellipsises, so "Search Conversation History" would render as "Search Conversati…".
    expect(humanizeToolName("search_conversation_history")).toBe("Search History");
  });

  it("falls back to title-casing an unrecognized snake_case id", () => {
    expect(humanizeToolName("some_new_tool")).toBe("Some New Tool");
  });

  it("never throws for an empty string", () => {
    expect(() => humanizeToolName("")).not.toThrow();
  });
});
