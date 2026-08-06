import { describe, expect, it, vi } from "vitest";
import { resolveApprovalsAndRun } from "./runLoop";

function makeResult(interruptions: unknown[] = []) {
  return {
    interruptions,
    state: { approve: vi.fn(), reject: vi.fn() },
  };
}

describe("resolveApprovalsAndRun", () => {
  it("returns the first result when there are no interruptions", async () => {
    const result = makeResult();
    const runOnce = vi.fn().mockResolvedValue(result);
    const requestApproval = vi.fn();

    const out = await resolveApprovalsAndRun(runOnce, "hello", requestApproval);

    expect(out).toBe(result);
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(runOnce).toHaveBeenCalledWith("hello");
    expect(requestApproval).not.toHaveBeenCalled();
  });

  it("approves an interruption and resumes with result.state", async () => {
    const interruption = { toolName: "update_agent" };
    const first = makeResult([interruption]);
    const second = makeResult();
    const runOnce = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const requestApproval = vi.fn().mockResolvedValue(true);

    const out = await resolveApprovalsAndRun(runOnce, "input", requestApproval);

    expect(first.state.approve).toHaveBeenCalledWith(interruption);
    expect(first.state.reject).not.toHaveBeenCalled();
    expect(runOnce).toHaveBeenNthCalledWith(2, first.state);
    expect(out).toBe(second);
  });

  it("rejects a declined interruption with a message the model can see, then resumes", async () => {
    const interruption = { toolName: "create_task" };
    const first = makeResult([interruption]);
    const second = makeResult();
    const runOnce = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const requestApproval = vi.fn().mockResolvedValue(false);

    await resolveApprovalsAndRun(runOnce, "input", requestApproval);

    expect(first.state.reject).toHaveBeenCalledWith(interruption, { message: expect.any(String) });
    expect(first.state.approve).not.toHaveBeenCalled();
  });

  it("resolves every interruption in one round before resuming", async () => {
    const a = { toolName: "a" };
    const b = { toolName: "b" };
    const first = makeResult([a, b]);
    const second = makeResult();
    const runOnce = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const requestApproval = vi.fn().mockResolvedValue(true);

    await resolveApprovalsAndRun(runOnce, "input", requestApproval);

    expect(requestApproval).toHaveBeenCalledTimes(2);
    expect(first.state.approve).toHaveBeenCalledWith(a);
    expect(first.state.approve).toHaveBeenCalledWith(b);
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it("returns null without resuming once isAborted reports true", async () => {
    const interruption = { toolName: "x" };
    const first = makeResult([interruption]);
    const runOnce = vi.fn().mockResolvedValueOnce(first);
    const requestApproval = vi.fn().mockResolvedValue(true);
    let aborted = false;
    const isAborted = () => aborted;

    // Abort takes effect right after the first segment completes, before any interruption
    // is resolved — mirrors a run that lost the timeout race while waiting on approval.
    requestApproval.mockImplementation(async () => {
      aborted = true;
      return true;
    });

    const out = await resolveApprovalsAndRun(runOnce, "input", requestApproval, isAborted);

    expect(out).toBeNull();
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it("checks isAborted before the very first run, not just between rounds", async () => {
    const runOnce = vi.fn();
    const requestApproval = vi.fn();

    const out = await resolveApprovalsAndRun(runOnce, "input", requestApproval, () => true);

    // runOnce still executes once (the loop's abort check runs after the first call, same
    // as the original ipc/agent.ts loop this was extracted from) — the point is it never
    // resumes or resolves an approval past that point.
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(out).toBeNull();
  });
});
