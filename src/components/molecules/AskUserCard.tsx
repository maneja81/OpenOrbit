import { useState } from "react";
import TablerIcon from "@/components/atoms/TablerIcon";
import { formatRemaining } from "@/lib/approvalCountdown";
import { useApprovalCountdown } from "@/hooks/useApprovalCountdown";

/** Mirrors ASK_USER_CANCELLED_SENTINEL in electron/main/ai/tools/askUserTools.ts — a fixed
 * value distinct from any real, user-composed answer by construction. KI-2: before Cancel
 * existed, a required question had no way out at all, so a user trying to move on to an
 * unrelated message had nowhere to type it except this card's own input — which then
 * submitted their message as if it were the literal answer. Cancel means "I'm not
 * answering this," never a default value (that's still Skip, for optional fields only). */
const ASK_USER_CANCELLED_SENTINEL = "[user cancelled — did not answer]";

export interface PendingQuestion {
  questionId: string;
  agentName: string;
  question: string;
  field: AskUserField;
  /** Absolute epoch ms at which main resolves with the fallback answer on the user's behalf. */
  expiresAt: number;
  /** When the renderer received it — same "recover the real window" reasoning as
   * PendingToolApproval.requestedAt. */
  requestedAt: number;
}

interface AskUserCardProps {
  pending: PendingQuestion;
  onAnswer: (questionId: string, answer: string) => void;
}

/**
 * The in-chat surface for ask_user — a real, structural pause (same semantics as
 * ToolApprovalCard: the run's timeout clock is stopped until this resolves), not a
 * suggestion the model can bunch with others. Renders one of two shapes from `field`:
 *
 * - `text`: a single input. Enter or the Answer button submits it; Skip (only when
 *   `!required`) submits the field's own placeholder as the literal answer.
 * - `single_select`: one button per option, plus an always-present "something else" text
 *   fallback the UI adds itself — never authored by the model, matching the reference
 *   quick-reply widget this is modeled on.
 *
 * Rendered at the end of the chat log, same as ToolApprovalCard; AgentsApp disables the
 * send button while one is outstanding for the same reason (a second message must not
 * start a concurrent run against a conversation that's mid-question).
 */
export default function AskUserCard({ pending, onAnswer }: AskUserCardProps) {
  const { field } = pending;
  const [textValue, setTextValue] = useState("");
  const [somethingElseOpen, setSomethingElseOpen] = useState(false);
  const [somethingElseValue, setSomethingElseValue] = useState("");
  const msLeft = useApprovalCountdown(pending.expiresAt);

  const submit = (answer: string) => onAnswer(pending.questionId, answer);
  const canSkip = !field.required;

  return (
    <div className="ask-user-card" role="group" aria-label="Question">
      <div className="ask-user-card-head">
        <TablerIcon name="ti-message-question" />
        <span>
          <strong>{pending.agentName}</strong> asks:
        </span>
      </div>
      <p className="ask-user-card-question">{pending.question}</p>

      {field.type === "single_select" && (
        <div className="ask-user-card-options">
          {field.options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className="ask-user-card-option"
              onClick={() => submit(option.value)}
            >
              <span className="ask-user-card-option-index">{index + 1}</span>
              <span className="ask-user-card-option-label">{option.label}</span>
            </button>
          ))}
          {somethingElseOpen ? (
            <form
              className="ask-user-card-option ask-user-card-option--input"
              onSubmit={(e) => {
                e.preventDefault();
                if (somethingElseValue.trim()) submit(somethingElseValue.trim());
              }}
            >
              <TablerIcon name="ti-pencil" />
              <input
                autoFocus
                type="text"
                value={somethingElseValue}
                onChange={(e) => setSomethingElseValue(e.target.value)}
                placeholder="Type your own answer…"
              />
            </form>
          ) : (
            <button type="button" className="ask-user-card-option" onClick={() => setSomethingElseOpen(true)}>
              <TablerIcon name="ti-pencil" className="ask-user-card-option-index" />
              <span className="ask-user-card-option-label">Something else</span>
            </button>
          )}
        </div>
      )}

      {field.type === "text" && (
        <form
          className="ask-user-card-text-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (textValue.trim()) submit(textValue.trim());
          }}
        >
          <input
            autoFocus
            type="text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            placeholder={field.placeholder ?? "Type your answer…"}
          />
          <button type="submit" className="settings-action-btn-sm settings-action-btn-primary" disabled={!textValue.trim()}>
            Answer
          </button>
        </form>
      )}

      {msLeft !== null && (
        <p className={`ask-user-card-expiry${msLeft <= 30_000 ? " ask-user-card-expiry--soon" : ""}`} aria-live="polite">
          {msLeft > 0 ? (
            <>
              Defaults automatically in <strong>{formatRemaining(msLeft)}</strong>
            </>
          ) : (
            "Expired — using default…"
          )}
        </p>
      )}

      <div className="ask-user-card-actions">
        {canSkip && (
          <button
            type="button"
            className="settings-action-btn-sm settings-action-btn-ghost"
            onClick={() => submit(field.placeholder ?? "")}
          >
            Skip
          </button>
        )}
        {/* Always available, required or not — see the sentinel comment above. Distinct from
            Skip: this never submits a default value, it tells the asking agent the user
            declined to answer at all. */}
        <button
          type="button"
          className="settings-action-btn-sm settings-action-btn-ghost"
          onClick={() => submit(ASK_USER_CANCELLED_SENTINEL)}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
