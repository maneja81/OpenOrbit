import { describe, expect, it } from "vitest";
import { ORCHESTRATOR_TOOL_NAMES, computeAgentLayout, matchAgentSlashCommand, slugifyAgentName } from "./agents";
import { humanizeToolName } from "./humanizeToolName";

function makeRows(n: number): AgentDisplayRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `agent-${i}`,
    name: `Agent ${i}`,
    icon: "icon",
    tagline: "",
    description: "",
    prompt: "",
    model: "",
    tools: "",
    enabled: 1,
    system: 0,
    created_at: "",
    mcp_server_ids: "[]",
    connector_ids: "[]",
    http_tool_collection_ids: "[]", provider_id: "",
    toolNames: [],
    connectorToolCount: 0,
  }));
}

describe("ORCHESTRATOR_TOOL_NAMES", () => {
  // This list is hand-mirrored from buildOrchestrator()'s `tools: [...]` array, which the
  // renderer can't import across the tsconfig project boundary — so it can drift, and did:
  // it carried `search_history` (the variable name) instead of the tool's real id.
  // Source of truth: searchHistoryTool (electron/main/ai/tools/history.ts),
  // getCurrentLocationTool (electron/main/ai/agents.ts), createSaveUserInfoTool
  // (electron/main/ai/tools/userInfoTools.ts).
  it("holds the orchestrator's real registered tool ids", () => {
    expect(ORCHESTRATOR_TOOL_NAMES).toEqual([
      "search_conversation_history",
      "get_current_location",
      "save_user_info",
    ]);
  });

  it("renders every id through a label short enough for the activity feed", () => {
    // The drift showed up as an ellipsised "Search Conversati…" in the feed, so the
    // labels these ids resolve to are part of the contract, not just the ids.
    expect(ORCHESTRATOR_TOOL_NAMES.map(humanizeToolName)).toEqual([
      "Search History",
      "Get Current Location",
      "Save User Info",
    ]);
  });
});

describe("computeAgentLayout", () => {
  it("returns an empty array for an empty input", () => {
    expect(computeAgentLayout([])).toEqual([]);
  });

  it("assigns a single agent to the inner band at the top of the orbit", () => {
    const [item] = computeAgentLayout(makeRows(1));
    expect(item.band).toBe("inner");
    expect(item.angle).toBeCloseTo(-Math.PI / 2);
    expect(item.orbitTime).toBeCloseTo(0);
  });

  it("alternates inner/outer bands by index", () => {
    const items = computeAgentLayout(makeRows(4));
    expect(items.map((i) => i.band)).toEqual(["inner", "outer", "inner", "outer"]);
  });

  it("computes angle/orbitTime as a fraction of a full circle", () => {
    const items = computeAgentLayout(makeRows(4));
    expect(items[0].angle).toBeCloseTo(-Math.PI / 2);
    expect(items[1].angle).toBeCloseTo(0);
    expect(items[2].angle).toBeCloseTo(Math.PI / 2);
    expect(items[3].angle).toBeCloseTo(Math.PI);

    expect(items[0].orbitTime).toBeCloseTo(0);
    expect(items[1].orbitTime).toBeCloseTo(Math.PI / 2);
    expect(items[2].orbitTime).toBeCloseTo(Math.PI);
    expect(items[3].orbitTime).toBeCloseTo((3 * Math.PI) / 2);
  });

  it("preserves the original row fields alongside the computed layout fields", () => {
    const [item] = computeAgentLayout(makeRows(1));
    expect(item.id).toBe("agent-0");
  });
});

describe("slugifyAgentName", () => {
  it("lowercases and hyphenates multi-word names", () => {
    expect(slugifyAgentName("Bank Analyst")).toBe("bank-analyst");
  });

  it("leaves a single-word name lowercased with no hyphen", () => {
    expect(slugifyAgentName("Cipher")).toBe("cipher");
  });
});

describe("matchAgentSlashCommand", () => {
  const agents = [{ name: "Cipher" }, { name: "Bank Analyst" }];

  it("routes a matching agent slug to that agent with the rest of the message", () => {
    const result = matchAgentSlashCommand("/cipher change my agent's name", agents);
    expect(result?.agent.name).toBe("Cipher");
    expect(result?.rest).toBe("change my agent's name");
  });

  it("matches case-insensitively and across multi-word slugs", () => {
    const result = matchAgentSlashCommand("/Bank-Analyst what did I spend?", agents);
    expect(result?.agent.name).toBe("Bank Analyst");
  });

  it("returns null when the slug doesn't match any agent (e.g. a system command)", () => {
    expect(matchAgentSlashCommand("/settings open the panel", agents)).toBeNull();
  });

  it("returns null for a bare slash command with no trailing message", () => {
    expect(matchAgentSlashCommand("/cipher", agents)).toBeNull();
  });

  it("returns null for plain text with no leading slash", () => {
    expect(matchAgentSlashCommand("hello cipher", agents)).toBeNull();
  });
});
