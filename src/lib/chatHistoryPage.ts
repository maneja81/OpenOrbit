/** Page math for the /chat-history modal. Pages are 0-indexed and counted back from the
 * newest message — page 0 is the most recent batch — because that's the end of a
 * conversation someone opens history to find. */

export const CHAT_HISTORY_PAGE_SIZE = 20;

/** Always at least 1, so an empty history still renders "Page 1 of 1" rather than "of 0". */
export function totalPages(total: number, pageSize: number = CHAT_HISTORY_PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Keeps the requested page inside the range that actually exists — the stored page can
 * fall off the end when new messages arrive, or when history is wiped by a reset. */
export function clampPage(page: number, total: number, pageSize: number = CHAT_HISTORY_PAGE_SIZE): number {
  const last = totalPages(total, pageSize) - 1;
  if (!Number.isFinite(page)) return 0;
  return Math.min(Math.max(Math.trunc(page), 0), last);
}

/**
 * Which messages this page holds, numbered 1..total from the *oldest* message — the
 * numbering people expect when reading a range ("41–60 of 118"), even though the paging
 * itself walks backwards from the newest.
 *
 * Returns a zeroed range for an empty history so callers can suppress the label entirely.
 */
export function pageRange(
  page: number,
  total: number,
  pageSize: number = CHAT_HISTORY_PAGE_SIZE
): { start: number; end: number } {
  if (total <= 0) return { start: 0, end: 0 };
  const safePage = clampPage(page, total, pageSize);
  const end = total - safePage * pageSize;
  const start = Math.max(1, end - pageSize + 1);
  return { start, end };
}
