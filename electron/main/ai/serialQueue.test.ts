import { describe, expect, it } from "vitest";
import { createSerialQueue } from "./serialQueue";

/** Lets the internal promise chain settle. A queued task starts one link later than a
 * single `await Promise.resolve()` covers, so drain the microtask queue instead of counting
 * ticks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A stand-in for the renderer round-trip: records what it has been handed and lets the
 * test resolve each one by hand, so overlap is observable rather than timing-based. */
function controllable() {
  const started: string[] = [];
  const resolvers: ((value: string) => void)[] = [];
  const task = (label: string) => () => {
    started.push(label);
    return new Promise<string>((resolve) => resolvers.push(resolve));
  };
  return { started, resolvers, task };
}

describe("createSerialQueue", () => {
  // The real failure this exists for: gpt-4.1-mini emitted nine ask_user calls in a single
  // assistant turn, the SDK ran every execute() concurrently, the UI could only show one,
  // and the other eight resolved as cancelled without the user ever seeing them.
  it("does not start a second task while the first is unsettled", async () => {
    const { started, resolvers, task } = controllable();
    const queue = createSerialQueue();

    const first = queue.run(task("income"));
    const second = queue.run(task("currency"));
    await flush();

    expect(started).toEqual(["income"]);

    resolvers[0]("343000");
    await expect(first).resolves.toBe("343000");
    await flush();

    expect(started).toEqual(["income", "currency"]);
    resolvers[1]("INR");
    await expect(second).resolves.toBe("INR");
  });

  it("runs everything queued, in the order it was requested", async () => {
    const { started, resolvers, task } = controllable();
    const queue = createSerialQueue();
    const labels = ["one", "two", "three"];

    const all = Promise.all(labels.map((l) => queue.run(task(l))));
    for (let i = 0; i < labels.length; i += 1) {
      await flush();
      expect(started).toHaveLength(i + 1);
      resolvers[i](`answer-${i}`);
      await flush();
    }

    await expect(all).resolves.toEqual(["answer-0", "answer-1", "answer-2"]);
    expect(started).toEqual(labels);
  });

  it("keeps serving the queue after one task rejects, and still rejects that caller", async () => {
    const { started, resolvers, task } = controllable();
    const queue = createSerialQueue();

    const first = queue.run(() => Promise.reject(new Error("boom")));
    const second = queue.run(task("still runs?"));
    await expect(first).rejects.toThrow("boom");
    await flush();

    expect(started).toEqual(["still runs?"]);
    resolvers[0]("yes");
    await expect(second).resolves.toBe("yes");
  });

  // Questions and approvals share one queue per run, so an approval modal can never land on
  // top of a question card — the constraint is the user's attention, not either mechanism.
  it("interleaves two different kinds of prompt through the same queue", async () => {
    const { started, resolvers, task } = controllable();
    const queue = createSerialQueue();

    const question = queue.run(task("question"));
    const approval = queue.run(task("approval"));
    await flush();
    expect(started).toEqual(["question"]);

    resolvers[0]("answered");
    await flush();
    expect(started).toEqual(["question", "approval"]);

    resolvers[1]("approved");
    await expect(Promise.all([question, approval])).resolves.toEqual(["answered", "approved"]);
  });

  it("reports depth as tasks queue and drain", async () => {
    const { resolvers, task } = controllable();
    const queue = createSerialQueue();
    expect(queue.depth()).toBe(0);

    const first = queue.run(task("a"));
    const second = queue.run(task("b"));
    // Counted on submission, before the first task has even been given a turn to start.
    expect(queue.depth()).toBe(2);

    await flush();
    resolvers[0]("done");
    await first;
    await flush();
    expect(queue.depth()).toBe(1);

    resolvers[1]("done");
    await second;
    await flush();
    expect(queue.depth()).toBe(0);
  });
});
