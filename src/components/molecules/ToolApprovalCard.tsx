import TablerIcon from "@/components/atoms/TablerIcon";
import { humanizeToolName } from "@/lib/humanizeToolName";
import { formatRemaining } from "@/lib/approvalCountdown";
import { useApprovalCountdown } from "@/hooks/useApprovalCountdown";
import type { PendingToolApproval } from "@/components/molecules/HttpToolApprovalModal";

interface ToolApprovalCardProps {
  approval: PendingToolApproval;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** Pretty-prints the call arguments for review. Falls back to the raw string if it isn't
 * JSON — showing something readable beats showing nothing. Same rule as the modal's. */
function formatArgs(args: string | undefined): string | null {
  if (!args) return null;
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

/**
 * The in-chat alternative to HttpToolApprovalModal, chosen by Settings → HTTP Tools →
 * "Ask me with". Identical semantics — the run is genuinely paused on this answer, and its
 * timeout clock is stopped — it just doesn't cover the rest of the app.
 *
 * Rendered at the end of the chat log so it reads as the newest thing in the conversation.
 * Because it doesn't trap focus the way a modal does, AgentsApp disables the send button
 * while one is outstanding; otherwise a second message could start a concurrent run against
 * a conversation that's mid-approval.
 */
export default function ToolApprovalCard({ approval, onRespond }: ToolApprovalCardProps) {
  const formattedArgs = formatArgs(approval.args);
  // Same deadline as the modal's — toolApprovalDisplay only chooses which surface shows it,
  // so a countdown on one and not the other would make the setting change the stakes.
  const msLeft = useApprovalCountdown(approval.expiresAt);

  return (
    <div className="tool-approval-card" role="group" aria-label="Tool approval request">
      <div className="tool-approval-card-head">
        <TablerIcon name="ti-shield-check" />
        <span>
          {approval.agentName ? `${approval.agentName} wants to run ` : "Your agent wants to run "}
          <strong>{humanizeToolName(approval.toolName)}</strong>
        </span>
      </div>
      {formattedArgs && <pre className="tool-approval-card-args">{formattedArgs}</pre>}
      {msLeft !== null && (
        <p
          className={`tool-approval-card-expiry${msLeft <= 30_000 ? " tool-approval-card-expiry--soon" : ""}`}
          aria-live="polite"
        >
          {msLeft > 0 ? (
            <>
              Declines automatically in <strong>{formatRemaining(msLeft)}</strong>
            </>
          ) : (
            "Expired — declining…"
          )}
        </p>
      )}
      <div className="tool-approval-card-actions">
        <button
          type="button"
          className="settings-action-btn-sm settings-action-btn-ghost"
          onClick={() => onRespond(approval.approvalId, false)}
        >
          Don&apos;t run
        </button>
        <button
          type="button"
          className="settings-action-btn-sm settings-action-btn-primary"
          onClick={() => onRespond(approval.approvalId, true)}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
