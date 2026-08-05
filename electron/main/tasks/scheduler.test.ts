import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const runMock = vi.hoisted(() => vi.fn());
vi.mock("@openai/agents", () => ({ run: runMock }));

const buildOrchestratorMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/agents", () => ({
  buildOrchestrator: buildOrchestratorMock,
  listAgents: vi.fn(() => []),
}));

const closeMcpServersMock = vi.hoisted(() => vi.fn());
vi.mock("../ai/mcp", () => ({ closeMcpServers: closeMcpServersMock }));

const getDueTasksMock = vi.hoisted(() => vi.fn<(nowIso: string) => import("../db/tasksStore").TaskRow[]>(() => []));
const recordTaskRunMock = vi.hoisted(() => vi.fn());
vi.mock("../db/tasksStore", () => ({ getDueTasks: getDueTasksMock, recordTaskRun: recordTaskRunMock }));

const cancelPendingForTraceMock = vi.hoisted(() => vi.fn());
vi.mock("../db/checklistStore", () => ({ cancelPendingForTrace: cancelPendingForTraceMock }));

const notificationConstructorMock = vi.hoisted(() => vi.fn());
vi.mock("electron", () => {
  class MockNotification {
    static isSupported = () => true;
    show = vi.fn();
    constructor(options: { title: string; body: string }) {
      notificationConstructorMock(options);
    }
  }
  return {
    Notification: MockNotification,
    BrowserWindow: { getAllWindows: () => [] },
  };
});

import {
  computeNextRunAt,
  notify,
  renderTaskPrompt,
  runPromptTask,
  startTaskScheduler,
  stopTaskScheduler,
  waitForInFlightPoll,
} from "./scheduler";
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
  cancelPendingForTraceMock.mockReset();
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
    // A run that stops here unattended must not leave a checklist item stuck "in progress"
    // forever — same reasoning as ipc/agent.ts's abandonApprovalsFor on the interactive path.
    expect(cancelPendingForTraceMock).toHaveBeenCalledTimes(1);
  });

  it("passes a fresh traceId to buildOrchestrator on every run, distinct per call", async () => {
    runMock.mockResolvedValue({ finalOutput: "ok", interruptions: [] });

    await runPromptTask(makeTask());
    await runPromptTask(makeTask());

    const traceIds = buildOrchestratorMock.mock.calls.map((call) => call[1]);
    expect(traceIds).toHaveLength(2);
    expect(typeof traceIds[0]).toBe("string");
    expect(traceIds[0]).not.toBe(traceIds[1]);
  });

  it("cancels pending checklist items when the run throws", async () => {
    runMock.mockRejectedValue(new Error("boom"));

    await expect(runPromptTask(makeTask())).rejects.toThrow("boom");
    expect(cancelPendingForTraceMock).toHaveBeenCalledTimes(1);
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

// KI-15: stopTaskScheduler only ever cleared the poll interval — it never waited for a task
// already mid-run, so app quit could abandon it before runPromptTask's
// `finally { await closeMcpServers(mcpServers) }` ran, orphaning MCP subprocesses.
describe("waitForInFlightPoll", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getDueTasksMock.mockReset().mockReturnValue([]);
    recordTaskRunMock.mockReset();
  });

  afterEach(() => {
    stopTaskScheduler();
    vi.useRealTimers();
  });

  it("resolves immediately when no poll is in flight", async () => {
    await expect(waitForInFlightPoll()).resolves.toBeUndefined();
  });

  it("resolves only once the in-flight poll actually finishes", async () => {
    let releaseRun: (value: { finalOutput: string; interruptions: never[] }) => void = () => {};
    const runGate = new Promise((resolve) => {
      releaseRun = resolve as typeof releaseRun;
    });
    // A prompt task's run() call is the awaited step in processDueTask (via runPromptTask),
    // unlike a plain reminder's recordTaskRun, which isn't awaited — gating here is what
    // actually keeps the poll in flight.
    getDueTasksMock.mockReturnValue([makeTask({ prompt: "do the thing" })]);
    buildOrchestratorMock.mockResolvedValue({ agent: { name: "Orbit" }, mcpServers: [], allAgents: [] });
    runMock.mockReturnValue(runGate);

    startTaskScheduler();
    await vi.advanceTimersByTimeAsync(30_000); // POLL_INTERVAL_MS — fires the first tick

    let resolved = false;
    const waited = waitForInFlightPoll().then(() => {
      resolved = true;
    });

    // Still pending — run()'s promise hasn't settled yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);

    releaseRun({ finalOutput: "done", interruptions: [] });
    await waited;
    expect(resolved).toBe(true);
  });
});

// KI-22: notify() truncated the body but not the title, even though task.title is user- or
// agent-authored with no length cap of its own — and becomes `${task.title} — failed` on a
// failure notification, making an already-long title longer still.
describe("notify", () => {
  beforeEach(() => {
    notificationConstructorMock.mockReset();
  });

  it("truncates a long title the same way it already truncates the body", () => {
    const longTitle = "x".repeat(500);
    const longBody = "y".repeat(500);

    notify(longTitle, longBody);

    expect(notificationConstructorMock).toHaveBeenCalledTimes(1);
    const [{ title, body }] = notificationConstructorMock.mock.calls[0];
    expect(title.length).toBeLessThan(longTitle.length);
    expect(body.length).toBeLessThan(longBody.length);
  });

  it("leaves a short title and body untouched", () => {
    notify("Reminder", "Time to check in.");

    const [{ title, body }] = notificationConstructorMock.mock.calls[0];
    expect(title).toBe("Reminder");
    expect(body).toBe("Time to check in.");
  });
});
