import { describe, expect, it } from "vitest";
import { firstFenceOffset, hasCodeFence } from "./codeFence";

describe("hasCodeFence", () => {
  it("finds a fence at the start of a line", () => {
    expect(hasCodeFence("```ts\nconst a = 1;\n```")).toBe(true);
    expect(hasCodeFence("here you go:\n\n```\nx\n```")).toBe(true);
  });

  it("accepts tilde fences", () => {
    // remark supports these; a backticks-only test skipped them and lost the tour anchor.
    expect(hasCodeFence("~~~js\nx\n~~~")).toBe(true);
  });

  it("accepts up to three spaces of indent, the CommonMark limit", () => {
    expect(hasCodeFence("   ```\nx\n```")).toBe(true);
    // Four spaces is an indented code block, not a fence — no <pre class=language-*> results.
    expect(hasCodeFence("    ```\nx")).toBe(false);
  });

  it("rejects backticks that are not at the start of a line", () => {
    // The bug this exists to prevent: ChatPanel used text.includes("```"), claimed the tour
    // anchor for a message like this, and then no matching block ever rendered.
    expect(hasCodeFence("run ``` to open a fence")).toBe(false);
    expect(hasCodeFence("use `npm run build` first")).toBe(false);
  });

  it("rejects a blockquoted fence", () => {
    // It renders a code block, but its source offset never matches, so it must not claim
    // the anchor.
    expect(hasCodeFence("> ```ts\n> x\n> ```")).toBe(false);
  });
});

describe("firstFenceOffset", () => {
  it("points at the first fence marker, not the line start", () => {
    const text = "intro\n\n   ```ts\nx\n```";
    expect(firstFenceOffset(text)).toBe(text.indexOf("```"));
  });

  it("points at the first of two identical fences", () => {
    const fence = "```ts\nx\n```";
    const text = `${fence}\n\n${fence}`;
    expect(firstFenceOffset(text)).toBe(0);
  });

  it("handles a tilde fence", () => {
    const text = "a\n~~~\nx\n~~~";
    expect(firstFenceOffset(text)).toBe(text.indexOf("~~~"));
  });

  it("returns null with no fence", () => {
    expect(firstFenceOffset("just prose")).toBeNull();
  });
});
