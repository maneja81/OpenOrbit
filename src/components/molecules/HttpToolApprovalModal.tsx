import Modal from "@/components/atoms/Modal";
import { humanizeToolName } from "@/lib/humanizeToolName";

export interface PendingToolApproval {
  approvalId: string;
  toolName: string;
  agentName?: string;
  /** Raw JSON argument string from the SDK, when it exposed one. */
  args?: string;
}

interface HttpToolApprovalModalProps {
  approval: PendingToolApproval | null;
  onRespond: (approvalId: string, approved: boolean) => void;
}

/** Pretty-prints the call arguments for review. Falls back to the raw string if it isn't
 * JSON — showing something the user can read beats showing nothing. */
function formatArgs(args: string | undefined): string | null {
  if (!args) return null;
  try {
    return JSON.stringify(JSON.parse(args), null, 2);
  } catch {
    return args;
  }
}

/**
 * Asks the user to approve one confirmation-gated tool call. The agent run is genuinely
 * paused while this is open (its timeout clock is stopped in ipc/agent.ts), so there is no
 * time pressure to answer — but leaving it unanswered for five minutes declines the call.
 *
 * Deliberately not dismissible by clicking away: closing without an answer would leave the
 * run hanging with no visible reason, so the only exits are Approve and Don't run.
 */
export default function HttpToolApprovalModal({ approval, onRespond }: HttpToolApprovalModalProps) {
  const formattedArgs = formatArgs(approval?.args);

  return (
    <Modal
      open={approval !== null}
      onClose={() => approval && onRespond(approval.approvalId, false)}
      label="Run this tool?"
    >
      <div className="http-approval-body">
        <h3>Run this tool?</h3>
        <p className="http-approval-lead">
          {approval?.agentName ? `${approval.agentName} wants to run ` : "Your agent wants to run "}
          <span className="http-approval-tool">{humanizeToolName(approval?.toolName ?? "")}</span>. This changes data
          on the remote service, so it needs your go-ahead.
        </p>
        {formattedArgs && <pre className="http-approval-args">{formattedArgs}</pre>}
        <div className="http-approval-actions">
          <button
            type="button"
            className="settings-action-btn-sm settings-action-btn-ghost"
            onClick={() => approval && onRespond(approval.approvalId, false)}
          >
            Don't run
          </button>
          <button
            type="button"
            className="settings-action-btn settings-action-btn-primary"
            onClick={() => approval && onRespond(approval.approvalId, true)}
          >
            Approve
          </button>
        </div>
      </div>
    </Modal>
  );
}
