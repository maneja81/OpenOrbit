import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPausableDeadline } from "./pausableDeadline";
import { createSerialQueue } from "../ai/serialQueue";

/** Resolves to true if the deadline rejected within the advanced time, false otherwise —
 * the promise is intentionally never-resolving on the success path, so it can only be
 * observed by racing it. */
async function firedWithin(deadline: { promise: Promise<never> }, ms: number): Promise<boolean> {
  let fired = false;
  deadline.promise.catch(() => {
    fired = true;
  });
  await vi.advanceTimersByTimeAsync(ms);
  return fired;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createPausableDeadline", () => {
  it("rejects once the full budget elapses unpaused", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    expect(await firedWithin(deadline, 1001)).toBe(true);
  });

  it("does not fire while paused", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    deadline.pause();
    expect(await firedWithin(deadline, 5000)).toBe(false);
  });

  it("charges only unpaused time against the budget", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    await vi.advanceTimersByTimeAsync(600);
    deadline.pause();
    await vi.advanceTimersByTimeAsync(10_000);
    deadline.resume();
    expect(await firedWithin(deadline, 399)).toBe(false);
    expect(await firedWithin(deadline, 2)).toBe(true);
  });

  // The bug this counting exists for: a model can emit several ask_user (or approval) tool
  // calls in one turn and the SDK runs them concurrently. Without a count, the first answer
  // re-armed the clock while the other questions were still on screen, and the run died
  // mid-question.
  it("stays paused until every overlapping pause has resumed", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    deadline.pause();
    deadline.pause();
    deadline.pause();

    deadline.resume();
    expect(deadline.pausedCount()).toBe(2);
    expect(await firedWithin(deadline, 10_000)).toBe(false);

    deadline.resume();
    expect(await firedWithin(deadline, 10_000)).toBe(false);

    deadline.resume();
    expect(deadline.pausedCount()).toBe(0);
    expect(await firedWithin(deadline, 1001)).toBe(true);
  });

  it("ignores a resume with no matching pause rather than shortening the budget", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    deadline.resume();
    deadline.resume();
    expect(deadline.pausedCount()).toBe(0);
    expect(await firedWithin(deadline, 999)).toBe(false);
    expect(await firedWithin(deadline, 2)).toBe(true);
  });

  it("never fires after clear(), including while pauses are outstanding", async () => {
    const deadline = createPausableDeadline(1000, "timed out");
    deadline.pause();
    deadline.clear();
    expect(deadline.pausedCount()).toBe(0);
    expect(await firedWithin(deadline, 10_000)).toBe(false);
  });

  it("rejects with the message it was given", async () => {
    const deadline = createPausableDeadline(1000, "Agent run timed out after 1s");
    const seen = deadline.promise.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(1001);
    await expect(seen).resolves.toBe("Agent run timed out after 1s");
  });
});

/** The production incident, replayed against both halves of the fix: Cipher emitted nine
 * ask_user calls in one turn, the user answered slowly, and the run died at 60s while
 * questions were still on screen. Wired the way ipc/agent.ts wires it — serialize inside,
 * pause/resume around the whole wait. */
describe("nine concurrent questions against a 60s run deadline", () => {
  it("never times out while the user is still being asked", async () => {
    const deadline = createPausableDeadline(60_000, "Agent run timed out after 60s");
    const shown: string[] = [];
    let answerCurrent: ((answer: string) => void) | undefined;

    const queue = createSerialQueue();
    const askOne = (question: string) => () => {
      shown.push(question);
      return new Promise<string>((resolve) => {
        answerCurrent = resolve;
      });
    };
    const requestAnswer = (question: string) => {
      deadline.pause();
      return queue.run(askOne(question)).finally(() => deadline.resume());
    };

    const questions = Array.from({ length: 9 }, (_, i) => `question ${i}`);
    const answers = Promise.all(questions.map((q) => requestAnswer(q)));

    let timedOut = false;
    deadline.promise.catch(() => {
      timedOut = true;
    });

    for (let i = 0; i < questions.length; i += 1) {
      // Only ever one question in front of the user...
      await vi.advanceTimersByTimeAsync(0);
      expect(shown).toHaveLength(i + 1);
      // ...and each one takes the user 30s, well past the whole run budget in aggregate.
      await vi.advanceTimersByTimeAsync(30_000);
      answerCurrent?.(`answer ${i}`);
      await vi.advanceTimersByTimeAsync(0);
    }

    await expect(answers).resolves.toHaveLength(9);
    expect(shown).toEqual(questions);
    expect(timedOut).toBe(false);

    // The run's own 60s budget is untouched by the 270s spent waiting on the user.
    expect(await firedWithin(deadline, 59_999)).toBe(false);
    expect(await firedWithin(deadline, 2)).toBe(true);
  });
});
