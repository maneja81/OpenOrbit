import { describe, expect, it } from "vitest";
import { computeNextRunAt, renderTaskPrompt } from "./scheduler";

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
