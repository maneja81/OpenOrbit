import { humanizeToolName } from "@/lib/humanizeToolName";
import { formatApprovalWindow } from "@/lib/approvalCountdown";

/** Why an approval was resolved by something other than the user answering it. Mirrors
 * `ApprovalSettledReason` in electron/main/ipc/agent.ts, which is the sender. */
export type ApprovalSettledReason = "timeout" | "abandoned";

/**
 * What to tell the user when their approval prompt disappeared without them answering it.
 *
 * Both cases end the same way — the call did not run — but the reasons need different words:
 * a timeout is worth retrying and the user's own delay caused it, while an abandoned run is
 * not the user's doing and retrying the approval alone would achieve nothing.
 *
 * Silence was the old behaviour and the worst option: main had already declined the call while
 * the prompt sat on screen, so pressing Approve resolved nothing and looked like a dead button.
 *
 * `windowMs` is the deadline main actually enforced, recovered from the approval's own
 * expiresAt. The first version of this function hardcoded "5 minutes" while APPROVAL_TIMEOUT_MS
 * lived in electron/main/ipc/agent.ts; testing with a 20-second timeout produced a message
 * still claiming five minutes. Never restate a duration the other process owns.
 */
export function approvalSettledMessage(
  toolName: string,
  reason: ApprovalSettledReason,
  windowMs?: number
): string {
  const tool = humanizeToolName(toolName);
  if (reason !== "timeout") {
    return `The request to run ${tool} was dropped because the run ended, so it never ran.`;
  }
  // A missing or nonsensical window is possible if the payload predates expiresAt — say less
  // rather than say something wrong.
  const after = windowMs && windowMs > 0 ? ` after ${formatApprovalWindow(windowMs)}` : "";
  return `The request to run ${tool} expired${after}, so it was declined. Ask me again if you still want it.`;
}
