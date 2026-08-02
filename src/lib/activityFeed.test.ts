import { describe, expect, it } from "vitest";
import { buildActivityRows, formatStepDuration } from "./activityFeed";
import type { StepEvent } from "./agents";

function call(overrides: Partial<StepEvent> = {}): StepEvent {
  return { type: "tool_called", label: "Calling tool…", ...overrides };
}

function output(overrides: Partial<StepEvent> = {}): StepEvent {
  return { type: "tool_output", label: "Tool responded", ...overrides };
}

describe("formatStepDuration", () => {
  it("keeps sub-second timings in milliseconds", () => {
    expect(formatStepDuration(450)).toBe("450ms");
    expect(formatStepDuration(0)).toBe("0ms");
    expect(formatStepDuration(999)).toBe("999ms");
  });

  it("switches to one decimal place at a second and above", () => {
    expect(formatStepDuration(1000)).toBe("1.0s");
    expect(formatStepDuration(1200)).toBe("1.2s");
    expect(formatStepDuration(30_000)).toBe("30.0s");
  });

  it("returns an empty string for values that cannot be an elapsed time", () => {
    expect(formatStepDuration(-1)).toBe("");
    expect(formatStepDuration(NaN)).toBe("");
    expect(formatStepDuration(Infinity)).toBe("");
  });
});

describe("buildActivityRows", () => {
  it("returns an empty array for no steps", () => {
    expect(buildActivityRows([])).toEqual([]);
  });

  it("replaces the generic label with the humanized tool name", () => {
    const [row] = buildActivityRows([call({ toolName: "web_search" })]);
    expect(row.label).toBe("Web Search");
  });

  it("title-cases a tool name it has no lookup entry for", () => {
    // MCP and connector tools are user-installed, so the label must degrade, not break.
    const [row] = buildActivityRows([call({ toolName: "gmail_send_email" })]);
    expect(row.label).toBe("Gmail Send Email");
  });

  it("falls back to the event label when no tool name arrived", () => {
    expect(buildActivityRows([call()])[0].label).toBe("Calling tool…");
    expect(buildActivityRows([call({ toolName: "" })])[0].label).toBe("Calling tool…");
    expect(buildActivityRows([output()])[0].label).toBe("Tool responded");
  });

  it("carries the calling agent through", () => {
    const [row] = buildActivityRows([call({ toolName: "web_search", agentName: "Explorer" })]);
    expect(row.agentName).toBe("Explorer");
    expect(buildActivityRows([call({ toolName: "web_search" })])[0].agentName).toBeUndefined();
  });

  it("preserves type and order so StepFeed's dot colours and last-row glow still work", () => {
    const rows = buildActivityRows([
      { type: "message_received", label: "Message received" },
      call({ toolName: "web_search" }),
      output({ toolName: "web_search" }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(["message_received", "tool_called", "tool_output"]);
  });

  it("times a tool_output against its matching call", () => {
    const rows = buildActivityRows([
      call({ toolName: "web_search", callId: "c1", at: 1_000 }),
      output({ toolName: "web_search", callId: "c1", at: 2_200 }),
    ]);
    expect(rows[0].durationMs).toBeUndefined();
    expect(rows[1].durationMs).toBe(1_200);
  });

  it("pairs on callId so concurrent calls to the same tool keep their own timings", () => {
    const rows = buildActivityRows([
      call({ toolName: "web_search", callId: "c1", at: 1_000 }),
      call({ toolName: "web_search", callId: "c2", at: 1_100 }),
      output({ toolName: "web_search", callId: "c2", at: 1_500 }),
      output({ toolName: "web_search", callId: "c1", at: 3_000 }),
    ]);
    expect(rows[2].durationMs).toBe(400);
    expect(rows[3].durationMs).toBe(2_000);
  });

  it("pairs with the nearest earlier call when a callId repeats", () => {
    const rows = buildActivityRows([
      call({ callId: "c1", at: 1_000 }),
      call({ callId: "c1", at: 5_000 }),
      output({ callId: "c1", at: 5_400 }),
    ]);
    expect(rows[2].durationMs).toBe(400);
  });

  it("leaves the duration off when it cannot be derived", () => {
    // No matching call, missing timestamps on either side, and a clock delta that runs
    // backwards all degrade to a row without a duration rather than a wrong one.
    expect(buildActivityRows([output({ callId: "missing", at: 2_000 })])[0].durationMs).toBeUndefined();
    expect(
      buildActivityRows([call({ callId: "c1" }), output({ callId: "c1", at: 2_000 })])[1].durationMs
    ).toBeUndefined();
    expect(
      buildActivityRows([call({ callId: "c1", at: 1_000 }), output({ callId: "c1" })])[1].durationMs
    ).toBeUndefined();
    expect(
      buildActivityRows([call({ callId: "c1", at: 3_000 }), output({ callId: "c1", at: 1_000 })])[1].durationMs
    ).toBeUndefined();
  });

  it("never relabels a handoff from its underlying transfer_to tool call", () => {
    const rows = buildActivityRows([
      { type: "handoff_requested", label: "Handing off…", toolName: "transfer_to_atlas", callId: "c9", at: 1 },
      { type: "handoff_occurred", label: "Delegating to Atlas" },
    ]);
    expect(rows[0].label).toBe("Handing off…");
    expect(rows[1].label).toBe("Delegating to Atlas");
  });
});
