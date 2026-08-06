import { describe, expect, it, vi, beforeEach } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
const AgentMock = vi.hoisted(() => vi.fn());
vi.mock("@openai/agents", () => ({ run: runMock, Agent: AgentMock }));

import { guardLeakedChecklistReply, repairLeakedChecklistReply } from "./replyGuard";

beforeEach(() => {
  runMock.mockReset();
  AgentMock.mockReset();
});

// KI-7: this file exists specifically so the KI-6 guard's actual behavior (not just
// isLeakedChecklistJson's predicate — see checklistTools.test.ts for that) is unit-tested
// somewhere, since ipc/agent.ts itself (one of the two real call sites) has no test file.
describe("guardLeakedChecklistReply", () => {
  it("returns ordinary output untouched, without invoking the repair agent at all", async () => {
    const output = await guardLeakedChecklistReply("Your location is off. Want me to enable it?", "is location on?", "gpt-4.1-mini", "test");
    expect(output).toBe("Your location is off. Want me to enable it?");
    expect(runMock).not.toHaveBeenCalled();
  });

  it("repairs a leaked write_checklist JSON reply into the rewriter's natural-language answer", async () => {
    runMock.mockResolvedValue({ finalOutput: "Hi! How can I help today?" });
    const output = await guardLeakedChecklistReply(
      '{"items":[{"text":"Answer greeting directly, no tools needed","status":"pending"}]}',
      "hi",
      "gpt-4.1-mini",
      "test"
    );
    expect(output).toBe("Hi! How can I help today?");
  });

  // The shape actually seen in production, and the one the original JSON-only detector let
  // straight through: three turns in a row shipped this to the user as their whole reply.
  it("repairs a narrated write_checklist reply, not just the JSON one", async () => {
    runMock.mockResolvedValue({ finalOutput: "Your location access is on." });
    const output = await guardLeakedChecklistReply(
      'write_checklist with plan "Tell Mohit his location access is enabled" completed',
      "what's my locaiton?",
      "gpt-4.1-mini",
      "test"
    );
    expect(output).toBe("Your location access is on.");
  });

  it("repairs the bare narrated form too", async () => {
    runMock.mockResolvedValue({ finalOutput: "Chandigarh is about 1,833 km from you by road." });
    const output = await guardLeakedChecklistReply("write_checklist completed", "how far is chandigarh?", "gpt-4.1-mini", "test");
    expect(output).toBe("Chandigarh is about 1,833 km from you by road.");
  });

  it("leaves a genuine answer that merely mentions the tool alone", async () => {
    const reply = "I track my plan for each turn with write_checklist, which drives the checklist widget you can see.";
    const output = await guardLeakedChecklistReply(reply, "what's that checklist?", "gpt-4.1-mini", "test");
    expect(output).toBe(reply);
    expect(runMock).not.toHaveBeenCalled();
  });

  it("passes the model straight through to the repair Agent", async () => {
    runMock.mockResolvedValue({ finalOutput: "Hi there." });
    await guardLeakedChecklistReply('{"items":[{"text":"x","status":"pending"}]}', "hi", "gpt-4.1-mini", "test");
    expect(AgentMock).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4.1-mini" }));
  });
});

describe("repairLeakedChecklistReply", () => {
  it("falls back to a fixed honest message when the repair agent itself also produces JSON", async () => {
    runMock.mockResolvedValue({ finalOutput: '{"items":[{"text":"still leaking","status":"pending"}]}' });
    const output = await repairLeakedChecklistReply("hi", '{"items":[{"text":"x","status":"pending"}]}', "gpt-4.1-mini");
    expect(output).not.toContain("{");
    expect(output.length).toBeGreaterThan(0);
  });

  it("falls back to a fixed honest message when the repair agent's run throws", async () => {
    runMock.mockRejectedValue(new Error("boom"));
    const output = await repairLeakedChecklistReply("hi", '{"items":[{"text":"x","status":"pending"}]}', "gpt-4.1-mini");
    expect(output).not.toContain("{");
    expect(output.length).toBeGreaterThan(0);
  });

  it("falls back to a fixed honest message when the repair agent returns empty text", async () => {
    runMock.mockResolvedValue({ finalOutput: "" });
    const output = await repairLeakedChecklistReply("hi", '{"items":[{"text":"x","status":"pending"}]}', "gpt-4.1-mini");
    expect(output).not.toContain("{");
    expect(output.length).toBeGreaterThan(0);
  });

  it("never attaches any tools to the repair agent, so it can't re-trigger a side effect", async () => {
    runMock.mockResolvedValue({ finalOutput: "Hi." });
    await repairLeakedChecklistReply("hi", '{"items":[{"text":"x","status":"pending"}]}', "gpt-4.1-mini");
    const constructedWith = AgentMock.mock.calls[0][0];
    expect(constructedWith.tools).toBeUndefined();
  });
});
