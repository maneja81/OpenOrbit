import { formatApprovalWindow } from "@/lib/approvalCountdown";
import type { ApprovalSettledReason } from "@/lib/approvalSettledMessage";

/** Why a question was resolved by something other than the user answering it. Mirrors
 * `ApprovalSettledReason` in electron/main/ipc/agent.ts, which is the sender — reused as-is
 * rather than a duplicate type, since the two settle for the same two reasons. */
export type QuestionSettledReason = ApprovalSettledReason;

/**
 * What to tell the user when their question card disappeared without them answering it.
 * Same reasoning as approvalSettledMessage: silence would mean main already resolved the
 * question (with the field's placeholder, or the fixed timeout sentinel) while the card sat
 * on screen looking like it still needed an answer.
 */
export function questionSettledMessage(question: string, reason: QuestionSettledReason, windowMs?: number): string {
  if (reason !== "timeout") {
    return `The question "${question}" was dropped because the run ended.`;
  }
  const after = windowMs && windowMs > 0 ? ` after ${formatApprovalWindow(windowMs)}` : "";
  return `"${question}" went unanswered${after}, so I moved on with a default answer where I could.`;
}
