import { describe, expect, it, vi, beforeEach } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@openai/agents", () => ({ run: runMock }));

const buildOrchestratorMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/agents", () => ({
  buildOrchestrator: buildOrchestratorMock,
  listAgents: vi.fn(() => []),
}));

const closeMcpServersMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/mcp", () => ({ closeMcpServers: closeMcpServersMock }));

import { computeNextRunAt, renderTaskPrompt, runPromptTask } from "./scheduler";
import type { TaskRow } from "../db/tasksStore";

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "task-1",
    title: "Test task",
    notes: null,
    due_at: null,
    status: "pending",
    prompt: "Do the thing",
    prompt_target_agent_id: null,
    recurrence_interval_ms: null,
    recurrence_params: "{}",
    next_run_at: null,
    last_run_at: null,
    last_result: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const ORCHESTRATOR = { name: "Orbit" };

beforeEach(() => {
  runMock.mockReset();
  closeMcpServersMock.mockReset();
  buildOrchestratorMock.mockReset();
  buildOrchestratorMock.mockResolvedValue({ agent: ORCHESTRATOR, mcpServers: [], allAgents: [ORCHESTRATOR] });
});

// KI-5: a scheduled task's run() call previously never inspected result.interruptions, so a
// call to an approval-gated tool (an HTTP write, update_agent's prompt field, create_task —
// see KI-2/KI-4) stopped the run and left finalOutput undefined, silently recorded as "".
describe("runPromptTask", () => {
  it("returns the final output when nothing needs approval", async () => {
    runMock.mockResolvedValue({ finalOutput: "All done.", interruptions: [] });
    const output = await runPromptTask(makeTask());
    expect(output).toBe("All done.");
    expect(closeMcpServersMock).toHaveBeenCalledTimes(1);
  });

  it("declines every interruption and returns an explicit blocked message instead of finalOutput", async () => {
    const rejectMock = vi.fn();
    const interruption = { rawItem: { name: "send_email", callId: "call-1" } };
    runMock.mockResolvedValue({
      finalOutput: undefined,
      interruptions: [interruption],
      state: { reject: rejectMock },
    });

    const output = await runPromptTask(makeTask());

    expect(rejectMock).toHaveBeenCalledTimes(1);
    expect(rejectMock).toHaveBeenCalledWith(interruption, expect.objectContaining({ message: expect.any(String) }));
    expect(output).toContain("Blocked");
    expect(output).toContain("send_email");
    expect(output).not.toBe("");
  });
});

describe("renderTaskPrompt", () => {
  it("substitutes known placeholders from params", () => {
    expect(renderTaskPrompt("Summarize {{project}}", { project: "Alex" }, {})).toBe("Summarize Alex");
  });

  it("substitutes auto-injected keys", () => {
    expect(renderTaskPrompt("Last time: {{lastResult}}", {}, { lastResult: "done" })).toBe("Last time: done");
  });

  it("auto-injected keys win over a same-named user param", () => {
    expect(renderTaskPrompt("{{lastResult}}", { lastResult: "user value" }, { lastResult: "auto value" })).toBe(
      "auto value"
    );
  });

  it("leaves unknown placeholders untouched", () => {
    expect(renderTaskPrompt("{{unknownKey}}", {}, {})).toBe("{{unknownKey}}");
  });

  it("handles multiple placeholders in one template", () => {
    expect(
      renderTaskPrompt("{{a}} and {{b}}", { a: "one" }, { b: "two" })
    ).toBe("one and two");
  });
});

describe("computeNextRunAt", () => {
  it("adds the interval to the given time", () => {
    expect(computeNextRunAt("2026-01-01T00:00:00.000Z", 60_000)).toBe("2026-01-01T00:01:00.000Z");
  });

  it("computes from the passed-in time, not wall-clock now", () => {
    expect(computeNextRunAt("2020-01-01T00:00:00.000Z", 3_600_000)).toBe("2020-01-01T01:00:00.000Z");
  });
});
