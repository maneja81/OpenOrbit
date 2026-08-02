import { describe, expect, it } from "vitest";
import { isScrolledToBottom } from "./useScrollToBottom";

// The threshold is the whole behaviour: too tight and a half-scrolled last line flips the
// state, too loose and reading one message back still counts as "following".
describe("isScrolledToBottom", () => {
  it("is true when scrolled fully down", () => {
    expect(isScrolledToBottom({ scrollTop: 400, clientHeight: 200, scrollHeight: 600 })).toBe(true);
  });

  it("is true within the threshold of the bottom", () => {
    // 59px short of the end — still following a stream.
    expect(isScrolledToBottom({ scrollTop: 341, clientHeight: 200, scrollHeight: 600 })).toBe(true);
  });

  it("is false once scrolled past the threshold", () => {
    // 200px up: the reader is looking at something, and new content must not yank them down.
    expect(isScrolledToBottom({ scrollTop: 200, clientHeight: 200, scrollHeight: 600 })).toBe(false);
  });

  it("is true when the content is shorter than the viewport", () => {
    // Nothing to scroll — an empty or one-message log must not offer a jump button.
    expect(isScrolledToBottom({ scrollTop: 0, clientHeight: 200, scrollHeight: 120 })).toBe(true);
  });

  it("is true for a zero-sized container", () => {
    // jsdom reports all zeros; this is why ChatPanel's tests see no jump button.
    expect(isScrolledToBottom({ scrollTop: 0, clientHeight: 0, scrollHeight: 0 })).toBe(true);
  });
});
