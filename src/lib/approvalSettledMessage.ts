import { humanizeToolName } from "@/lib/humanizeToolName";

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
 */
export function approvalSettledMessage(toolName: string, reason: ApprovalSettledReason): string {
  const tool = humanizeToolName(toolName);
  return reason === "timeout"
    ? `The request to run ${tool} expired after 5 minutes, so it was declined. Ask me again if you still want it.`
    : `The request to run ${tool} was dropped because the run ended, so it never ran.`;
}
