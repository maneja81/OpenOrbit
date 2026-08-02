import { describe, expect, it } from "vitest";
import { CHAT_HISTORY_PAGE_SIZE, clampPage, pageRange, totalPages } from "./chatHistoryPage";

describe("totalPages", () => {
  it("reports one page for an empty history rather than zero", () => {
    // The pager renders "of N" — zero would read as broken.
    expect(totalPages(0)).toBe(1);
    expect(totalPages(-5)).toBe(1);
    expect(totalPages(NaN)).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(totalPages(20)).toBe(1);
    expect(totalPages(21)).toBe(2);
    expect(totalPages(118)).toBe(6);
  });

  it("uses the shared page size by default", () => {
    expect(CHAT_HISTORY_PAGE_SIZE).toBe(20);
    expect(totalPages(41)).toBe(totalPages(41, 20));
  });
});

describe("clampPage", () => {
  it("keeps a page inside what exists", () => {
    // Messages can be deleted between fetches, leaving the stored page past the end.
    expect(clampPage(9, 41)).toBe(2);
    expect(clampPage(-3, 41)).toBe(0);
  });

  it("collapses to page 0 for an empty history", () => {
    expect(clampPage(4, 0)).toBe(0);
  });

  it("leaves a valid page alone", () => {
    expect(clampPage(1, 41)).toBe(1);
  });
});

describe("pageRange", () => {
  it("numbers from the oldest message even though paging walks back from the newest", () => {
    // 118 messages: page 0 holds the newest 20, which are #99–118 chronologically.
    expect(pageRange(0, 118)).toEqual({ start: 99, end: 118 });
    expect(pageRange(1, 118)).toEqual({ start: 79, end: 98 });
  });

  it("gives the oldest page its short remainder", () => {
    expect(pageRange(5, 118)).toEqual({ start: 1, end: 18 });
  });

  it("covers every message exactly once across all pages", () => {
    const total = 47;
    const seen: number[] = [];
    for (let p = 0; p < totalPages(total); p++) {
      const { start, end } = pageRange(p, total);
      for (let i = start; i <= end; i++) seen.push(i);
    }
    expect(seen.sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
  });

  it("returns a zeroed range for an empty history so the label can be suppressed", () => {
    expect(pageRange(0, 0)).toEqual({ start: 0, end: 0 });
  });

  it("clamps an out-of-range page rather than producing a negative range", () => {
    expect(pageRange(99, 41)).toEqual({ start: 1, end: 1 });
  });
});
