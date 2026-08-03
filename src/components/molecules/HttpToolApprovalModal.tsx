import Modal from "@/components/atoms/Modal";
import { humanizeToolName } from "@/lib/humanizeToolName";
import { formatRemaining } from "@/lib/approvalCountdown";
import { useApprovalCountdown } from "@/hooks/useApprovalCountdown";

export interface PendingToolApproval {
  approvalId: string;
  toolName: string;
  agentName?: string;
  /** Raw JSON argument string from the SDK, when it exposed one. */
  args?: string;
  /** Absolute epoch ms at which main declines this call on the user's behalf. */
  expiresAt: number;
  /** When the renderer received it. Only used to recover the window's length for the
   * past-tense message — `expiresAt - requestedAt` is the timeout main is enforcing, which
   * beats hardcoding a duration the renderer can't see. */
  requestedAt: number;
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
 * Every exit answers the call; none of them leave the run hanging. Approve runs the tool,
 * Don't run and Escape decline it. Backdrop clicks are ignored (`closeOnBackdrop={false}`):
 * this modal's onClose is an *answer*, not a dismissal, and a mis-aimed click landing outside
 * the panel should not decide whether a POST or DELETE goes out. Escape is kept because it is
 * a deliberate keypress that already means cancel, and a dialog that swallows it is worse for
 * keyboard users than one that treats it as "no".
 *
 * An earlier version of this comment claimed the modal was not dismissible by clicking away.
 * It was — backdrop mousedown reached Modal's onClose and silently declined the call.
 */
export default function HttpToolApprovalModal({ approval, onRespond }: HttpToolApprovalModalProps) {
  const formattedArgs = formatArgs(approval?.args);
  const msLeft = useApprovalCountdown(approval?.expiresAt ?? null);

  return (
    <Modal
      open={approval !== null}
      onClose={() => approval && onRespond(approval.approvalId, false)}
      label="Run this tool?"
      closeOnBackdrop={false}
    >
      <div className="http-approval-body">
        <h3>Run this tool?</h3>
        <p className="http-approval-lead">
          {approval?.agentName ? `${approval.agentName} wants to run ` : "Your agent wants to run "}
          <span className="http-approval-tool">{humanizeToolName(approval?.toolName ?? "")}</span>. This changes data
          on the remote service, so it needs your go-ahead.
        </p>
        {formattedArgs && <pre className="http-approval-args">{formattedArgs}</pre>}
        {msLeft !== null && (
          // aria-live polite rather than off: a screen-reader user gets no other signal that
          // the prompt is about to answer itself. Not assertive — it must not interrupt them
          // reading the arguments they are being asked to approve.
          <p className={`http-approval-expiry${msLeft <= 30_000 ? " http-approval-expiry--soon" : ""}`} aria-live="polite">
            {msLeft > 0 ? (
              <>
                Declines automatically in <strong>{formatRemaining(msLeft)}</strong>
              </>
            ) : (
              "Expired — declining…"
            )}
          </p>
        )}
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
