/**
 * A run deadline that can be paused.
 *
 * A fixed-timer race is right when the only thing that can be slow is the model — but a
 * tool that needs the user's approval blocks on a human, and a human will routinely take
 * longer than the 60s default. Without pausing, enabling the confirmation gate on any tool
 * would make that tool's runs time out almost every time.
 *
 * Only *waiting on a person* pauses the clock. Model latency, tool execution, and network
 * time all still count against it, so a genuinely stuck run still dies on schedule.
 *
 * Pauses are reference-counted, because more than one human wait can genuinely overlap: a
 * model can emit several tool calls in a single turn and the SDK executes them
 * concurrently. Without counting, the first wait to finish re-armed the clock while the
 * others were still on screen, and the run died mid-question — the exact failure this
 * whole mechanism exists to prevent.
 *
 * Kept in its own module (rather than inline in ipc/agent.ts) so the pause/resume pairing
 * is directly unit-testable — see KI-7: ipc/agent.ts itself has no test file.
 */
export function createPausableDeadline(ms: number, message: string) {
  let remaining = ms;
  let startedAt = Date.now();
  let timer: NodeJS.Timeout | undefined;
  let pauseDepth = 0;
  let rejectFn: ((error: Error) => void) | undefined;

  const promise = new Promise<never>((_, reject) => {
    rejectFn = reject;
  });
  // The rejection is always consumed by the Promise.race in the caller; this keeps a
  // pause/resume cycle from tripping an unhandled-rejection warning in the window before
  // that race runs.
  promise.catch(() => {});

  const arm = () => {
    startedAt = Date.now();
    timer = setTimeout(() => rejectFn?.(new Error(message)), remaining);
  };
  arm();

  return {
    promise,
    pause() {
      pauseDepth += 1;
      if (!timer) return;
      clearTimeout(timer);
      timer = undefined;
      remaining = Math.max(0, remaining - (Date.now() - startedAt));
    },
    resume() {
      if (pauseDepth === 0) return;
      pauseDepth -= 1;
      // Someone else is still waiting on the user — stay paused until the last one resolves.
      if (pauseDepth > 0 || timer) return;
      arm();
    },
    clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      pauseDepth = 0;
    },
    /** The pause count, exposed because the pause/resume pairing is this module's whole
     * contract and is otherwise invisible from outside. */
    pausedCount() {
      return pauseDepth;
    },
  };
}
