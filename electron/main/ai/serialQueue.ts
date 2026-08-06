/**
 * A promise queue: hand it work, and it runs one item at a time in the order received.
 *
 * Built for the app's one hard constraint on asking the user things — **only one card can
 * be in front of them at a time** — which nothing in the SDK enforces for us.
 *
 * The `ask_user` tool was designed on the assumption that a tool call blocking the run made
 * "one question at a time" true by construction. It doesn't: a model can emit several tool
 * calls in a single assistant turn and the SDK invokes every `execute()` concurrently. In
 * manual testing nine questions fired at once, the UI could only show one, and the other
 * eight resolved as cancelled without the user ever seeing them.
 *
 * Approvals reach the same state by a different route. `resolveApprovalsAndRun` walks one
 * run's interruptions sequentially, so a single run is fine — but when the orchestrator
 * calls two specialists in the same turn, each nested run has its own loop, and both can
 * pause for approval at once.
 *
 * Questions and approvals share one queue per run rather than having one each, because the
 * constraint is about the user's attention, not about either mechanism: an approval modal
 * appearing on top of a question card is the same bug as two questions at once.
 *
 * Queueing rather than rejecting the extras: each queued item is something an agent
 * genuinely asked, so the right outcome is to get to it next, not to throw it away. Callers
 * are responsible for pausing any run deadline across the whole wait, queued time included —
 * see ipc/agent.ts.
 */
export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
  /** How many tasks are queued or in flight. Exposed for tests and diagnostics. */
  depth(): number;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  let depth = 0;

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      depth += 1;
      const result = tail.then(task);
      // The chain has to survive a rejected link, or one failed task would strand every
      // task queued behind it. The rejection still reaches the caller through `result`.
      tail = result.catch(() => undefined);
      return result.finally(() => {
        depth -= 1;
      }) as Promise<T>;
    },
    depth() {
      return depth;
    },
  };
}
