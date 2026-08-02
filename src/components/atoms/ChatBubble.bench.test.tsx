import { describe, expect, it, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import ChatBubble from "./ChatBubble";

/**
 * Measures what a streamed reply actually costs to render, so the memoization question that
 * has sat open since #74 is answered with a number instead of a guess.
 *
 * The bubble re-parses its whole markdown string on every chunk — true before #74 as well;
 * CodeBlock and ChatImage only added per-parse work on top. #74's plan named memoizing
 * CodeBlock on its `code` string as the remedy but deliberately did not pre-build it,
 * pending evidence of jank. This is that evidence.
 *
 * Not a pass/fail assertion on a wall-clock budget: CI machines vary far too much for that
 * to mean anything, and a flaky perf gate is worse than none. The threshold is set where a
 * *structural* regression would trip it — a change that makes re-parsing super-linear in the
 * number of chunks, which is the failure that would actually cause jank.
 */

// jsdom has no layout; CodeBlock's copy button and SlashCommandMenu-style scrolling need it.
Element.prototype.scrollIntoView = vi.fn();

/** A reply shaped like a real one: prose, a fenced block, a list and a table. */
const REPLY = [
  "Here's what I found while looking through the codebase.",
  "",
  "The handler lives in `electron/main/ipc/filesystem.ts` and does three things:",
  "",
  "1. Validates the path against the allowlist",
  "2. Reads the file off disk",
  "3. Extracts text if it's a document",
  "",
  "```ts",
  "export async function readFile(p: string): Promise<string> {",
  "  if (!isAllowed(p)) throw new Error(`Access denied: ${p}`);",
  "  return fs.readFile(p, 'utf8');",
  "}",
  "```",
  "",
  "| Step | Cost |",
  "| --- | --- |",
  "| validate | trivial |",
  "| read | I/O bound |",
  "",
  "That's the whole path, end to end.",
].join("\n");

/** Streaming arrives a few characters at a time; this is the number of renders a reply of
 * this size realistically causes. */
const CHUNKS = 60;

function renderStreamed(text: string, chunks: number): number {
  const step = Math.max(1, Math.ceil(text.length / chunks));
  const start = performance.now();
  const { rerender } = render(<ChatBubble role="assistant" text={text.slice(0, step)} avatarLabel="Orbit" />);
  for (let end = step * 2; end <= text.length + step; end += step) {
    rerender(<ChatBubble role="assistant" text={text.slice(0, Math.min(end, text.length))} avatarLabel="Orbit" />);
  }
  return performance.now() - start;
}

describe("ChatBubble streaming re-parse cost", () => {
  afterEach(cleanup);

  it("stays linear in the number of chunks", () => {
    // Warm up: first render pays for module init and jsdom setup, which would otherwise be
    // attributed to the low-chunk case and invert the ratio.
    renderStreamed(REPLY, 4);
    cleanup();

    const few = renderStreamed(REPLY, CHUNKS / 4);
    cleanup();
    const many = renderStreamed(REPLY, CHUNKS);
    cleanup();

    const ratio = many / few;
    // 4x the chunks should cost ~4x. Super-linear growth is the structural regression worth
    // catching; the ceiling is loose so ordinary machine noise can't trip it.
    expect(ratio, `4x chunks cost ${ratio.toFixed(1)}x (few=${few.toFixed(1)}ms many=${many.toFixed(1)}ms)`)
      .toBeLessThan(12);
  });

  it("renders the finished reply's structure correctly", () => {
    // Guards the benchmark itself: a bubble that silently rendered nothing would post
    // excellent numbers and measure the wrong thing.
    const { container } = render(<ChatBubble role="assistant" text={REPLY} avatarLabel="Orbit" />);
    expect(container.querySelector(".code-block")).not.toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelectorAll("li").length).toBe(3);
  });
});
