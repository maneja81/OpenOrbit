/**
 * Countdown formatting for the tool-approval prompt.
 *
 * Two shapes, deliberately different. `formatRemaining` is a live clock the user watches tick,
 * so it stays numeric and monospace-stable. `formatApprovalWindow` names the whole window in
 * prose, for the past-tense message after the prompt has gone.
 */

/** Ticking clock: "4:59", "0:20", "0:00". Never negative. */
export function formatRemaining(msLeft: number): string {
  const total = Math.max(0, Math.ceil(msLeft / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Prose duration for the whole approval window — "5 minutes", "20 seconds", "90 seconds".
 *
 * Derived from the deadline main actually sent rather than written into the copy. The message
 * used to read "expired after 5 minutes" from a hardcoded string while APPROVAL_TIMEOUT_MS
 * lived in electron/main/ipc/agent.ts; setting the timeout to 20s during testing produced a
 * message still claiming 5 minutes. Same class of split as the settings defaults recorded in
 * MEMORY.md, and this is the fix for it.
 */
export function formatApprovalWindow(totalMs: number): string {
  const seconds = Math.max(0, Math.round(totalMs / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  // Only whole minutes read naturally here; anything else stays in seconds rather than
  // rounding "90 seconds" to a wrong-sounding "2 minutes".
  if (seconds % 60 !== 0) return `${seconds} seconds`;
  const minutes = seconds / 60;
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/** True once the deadline has passed. Kept here so the components agree on the boundary. */
export function hasExpired(expiresAt: number, now: number): boolean {
  return now >= expiresAt;
}
