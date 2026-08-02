/**
 * A fenced code block opening at the start of a line — ``` or ~~~, up to three spaces in,
 * which is what CommonMark accepts before a fence stops being a fence.
 *
 * Lives here rather than in ChatBubble because two callers have to agree: the bubble decides
 * which <pre> becomes a CodeBlock, and ChatPanel decides which message carries the tour's
 * copy-button anchor. When those used different tests, a message whose backticks were inline
 * or blockquoted would claim the anchor and then render no matching block, so the anchor
 * vanished from the app entirely and the tour step was silently skipped.
 */
export const FENCE_PATTERN = /^ {0,3}(?:```|~~~)/m;

export function hasCodeFence(text: string): boolean {
  return FENCE_PATTERN.test(text);
}

/** Byte offset of the first fence marker, or null when there is no fence. Used to identify
 * the first block by position — unique even when two fences hold identical code. */
export function firstFenceOffset(text: string): number | null {
  const match = FENCE_PATTERN.exec(text);
  return match ? match.index + match[0].search(/[`~]/) : null;
}
