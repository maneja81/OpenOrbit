import { ReactNode, RefObject, useEffect, useState } from "react";
import ChatBubble, { MessageRole } from "@/components/atoms/ChatBubble";
import ChatInputBar, { DirectableAgent } from "@/components/molecules/ChatInputBar";
import TablerIcon from "@/components/atoms/TablerIcon";
import { StepEvent } from "@/lib/agents";
import { buildActivityRows, formatStepDuration, formatThoughtSeconds, THINKING_STEP_TYPES } from "@/lib/activityFeed";
import { formatMessageTime } from "@/lib/chatTime";
import { hasCodeFence } from "@/lib/codeFence";
import MessageCost from "@/components/atoms/MessageCost";
import { useTraceUsage } from "@/hooks/useTraceUsage";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";
import { sliceRecentConversations } from "@/lib/chatVisibility";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  avatarLabel: string;
  // Only set on assistant messages — the hand-off narration captured for that turn
  // (see THINKING_STEP_TYPES in AgentsApp.tsx), shown as a minimal toggle line.
  steps?: StepEvent[];
  // Also assistant-only: real wall-clock ms from send to this reply landing, set alongside
  // steps once the turn finishes. Drives the collapsed toggle's "Thought for Ns" label —
  // undefined while the turn is still in flight (see the separate live indicator below).
  elapsedMs?: number;
  // Also assistant-only: the run that produced this reply, used to look up what it cost.
  // Absent on the greeting, on bridge-unavailable/error replies, and on any turn whose
  // trace event didn't arrive — MessageCost renders nothing in all of those cases.
  traceId?: string;
  /** Epoch ms, stamped by appendMessage (AgentsApp) — shown in the turn's meta row. Not the
   * same clock as ChatHistoryModal's created_at, which is a SQL string from the database. */
  createdAt: number;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  agentName: string;
  listening: boolean;
  transcribing: boolean;
  voiceEnabled: boolean;
  agents: DirectableAgent[];
  /** Rendered at the end of the log when a tool is waiting on the user and the "Ask me
   * with" setting is the in-chat card. Null in modal mode, or when nothing is pending. */
  approvalCard?: ReactNode;
  /** Rendered at the end of the log when ask_user is waiting on an answer — always an
   * in-chat card, no modal mode (unlike approvals, there's no "Ask me with" setting for
   * this). Null when nothing is pending. */
  questionCard?: ReactNode;
  /** Epoch ms the in-flight turn started, or null/undefined when nothing is running —
   * renders the live dots+elapsed-timer indicator in place of the eventual completed
   * turn's collapsed toggle. Cleared by the caller the moment the run ends. */
  liveStartedAt?: number | null;
  /** The in-flight turn's step feed so far, read by the live indicator for its current
   * status word and (once expanded) its running activity list. */
  liveSteps?: StepEvent[];
  /** True while an approval or a question is outstanding, or a run is already in flight —
   * blocks sending so a second turn can't start a concurrent run against a conversation
   * that's mid-approval/mid-question/mid-response (a second send while Orbit is still
   * replying reset the in-progress step feed out from under the first run). */
  sendDisabled?: boolean;
  /** KI-3: which kind blocked it, forwarded to ChatInputBar so its placeholder describes
   * the actual pause instead of always assuming an approval gate. */
  sendDisabledReason?: "approval" | "question" | "responding";
  /** True for the whole span of an in-flight run — forwarded to ChatInputBar so it can swap
   * the send button for a Stop button. */
  responding?: boolean;
  /** Opens the full paged archive (ChatHistoryModal) — the log itself only keeps the last
   * visibleConversationCount conversations on screen. */
  onShowFullHistory: () => void;
  /** How many recent conversations (settings.chatVisibleConversations) stay in the live log —
   * see lib/chatVisibility.ts for what counts as one. Everything older is one click away via
   * onShowFullHistory. */
  visibleConversationCount: number;
  /** Forwarded to every bubble — see AgentsSettings.remoteImagesAutoLoad. */
  autoLoadRemoteImages?: boolean;
  onSend: () => void;
  onStop: () => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
}

/** The expandable body shared by the completed toggle and the live indicator — one row per
 * substantive step (hand-offs, tool calls), in order. */
function ActivityRows({ steps }: { steps: StepEvent[] }) {
  return (
    <div className="thinking-steps">
      {buildActivityRows(steps).map((row, i) => {
        const duration = row.durationMs === undefined ? "" : formatStepDuration(row.durationMs);
        return (
          <div key={i} className="thinking-step">
            {row.agentName && <span className="step-feed-agent">{row.agentName}</span>}
            <span className="step-feed-label">{row.label}</span>
            {duration && <span className="step-feed-duration">{duration}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Minimal text+chevron toggle for a finished turn's hand-off narration and how long it
 * took — deliberately not the full WidgetCard glass-panel shell (title bar, padding,
 * border) used elsewhere, since this is meant to read as a small inline disclosure, not
 * another panel. Open by default: this mounts the instant `LiveThinking` unmounts (the
 * turn just finished), so the activity it shows is the same content the user was already
 * watching live — starting collapsed made that handoff read as the tool trace vanishing
 * rather than settling into place. Renders as a plain (non-interactive) line, with no
 * chevron, when there's nothing substantive to expand into — a turn with no tool calls
 * still took real time, but there's no activity list behind the disclosure arrow. */
function ThinkingToggle({ steps, elapsedMs }: { steps: StepEvent[]; elapsedMs: number }) {
  const [open, setOpen] = useState(true);
  const label = `Thought for ${formatThoughtSeconds(elapsedMs)}`;
  if (steps.length === 0) {
    return (
      <div className="thinking-toggle">
        <span className="thinking-toggle-btn thinking-toggle-static">{label}</span>
      </div>
    );
  }
  return (
    <div className="thinking-toggle">
      <button type="button" className="thinking-toggle-btn" onClick={() => setOpen((o) => !o)}>
        <TablerIcon name={open ? "ti-chevron-down" : "ti-chevron-right"} />
        <span>{label}</span>
      </button>
      {open && <ActivityRows steps={steps} />}
    </div>
  );
}

/** Shown in place of a turn's eventual ThinkingToggle while it's still running: three
 * animated dots, a self-ticking elapsed timer (real wall clock, independent of parent
 * re-renders), and the current status word taken straight from the live step feed's last
 * entry — same narration the orb's status line already shows, just readable in the log
 * too. Expands to the substantive steps captured so far, same shape as the finished
 * toggle's body. */
function LiveThinking({ startedAt, steps }: { startedAt: number; steps: StepEvent[] }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const status = steps.at(-1)?.label || "Thinking…";
  const activitySteps = steps.filter((s) => THINKING_STEP_TYPES.has(s.type));
  return (
    <div className="thinking-toggle">
      <button
        type="button"
        className="thinking-toggle-btn"
        onClick={() => setOpen((o) => !o)}
        disabled={activitySteps.length === 0}
      >
        {activitySteps.length > 0 && <TablerIcon name={open ? "ti-chevron-down" : "ti-chevron-right"} />}
        <span className="thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>
          {formatThoughtSeconds(Math.max(0, now - startedAt))} · {status}
        </span>
      </button>
      {open && <ActivityRows steps={activitySteps} />}
    </div>
  );
}

export default function ChatPanel({
  messages,
  inputRef,
  agentName,
  listening,
  transcribing,
  voiceEnabled,
  agents,
  approvalCard,
  questionCard,
  liveStartedAt,
  liveSteps,
  sendDisabled,
  sendDisabledReason,
  responding,
  onShowFullHistory,
  visibleConversationCount,
  autoLoadRemoteImages,
  onSend,
  onStop,
  onStartVoice,
  onStopVoice,
}: ChatPanelProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useScrollToBottom<HTMLDivElement>();

  // The last visibleConversationCount conversations rather than the whole log — see
  // lib/chatVisibility.ts.
  const visible = sliceRecentConversations(messages, visibleConversationCount);
  const hasOlder = visible.length < messages.length;

  const usageByTrace = useTraceUsage(visible.map((m) => m.traceId));
  // Only the first costed bubble carries the tour's anchor id — ids must be unique, and
  // the tour needs one stable target rather than whichever happens to render last.
  const tourAnchorId = visible.find((m) => m.traceId)?.id;
  // Same rule for the code-block copy anchor. Assigned here rather than in ChatBubble so the
  // history modal, which renders the same component over this panel, never duplicates the id.
  // Uses ChatBubble's own fence test: a looser one (any "```" anywhere) burns the anchor on a
  // message whose backticks are inline or blockquoted, where no matching block ever renders.
  // Assistant-only, because four leading spaces turn a user's prose into a code block too,
  // and the tour step describes code arriving in a reply.
  const codeAnchorId = visible.find((m) => m.role === "assistant" && hasCodeFence(m.text))?.id;

  return (
    <div id="chat">
      {/* Above the scroller, not inside it: #chat-log carries the top-fade mask that
          dissolves the log into the orbit, and anything drawn under it renders half-faded. */}
      {hasOlder && (
        <button id="chat-history-link" className="history-link" type="button" onClick={onShowFullHistory}>
          <TablerIcon name="ti-history" />
          <span>Show full history</span>
        </button>
      )}
      <div id="chat-log" ref={containerRef}>
        {/* Pushes a short conversation down so turns start at the bottom of the log rather
            than the top, keeping the newest message next to the input either way. */}
        <div className="log-spacer" />
        {visible.map((message) => {
          const time = formatMessageTime(message.createdAt);
          // avatarLabel is a single initial (see AgentsApp) — the meta row wants a readable
          // name, so it takes the orchestrator's name rather than that letter.
          const who = message.role === "user" ? "You" : agentName;
          // The last handoff wins: a turn can bounce through more than one specialist, and
          // the meta row credits whoever actually produced the reply.
          const handoffTo = message.steps?.filter((s) => s.handoffTo).at(-1)?.handoffTo;
          return (
            <div key={message.id} className={`turn ${message.role}`}>
              {message.elapsedMs !== undefined && (
                <ThinkingToggle steps={message.steps ?? []} elapsedMs={message.elapsedMs} />
              )}
              <div className="turn-row">
                <span className="dot" />
                <ChatBubble
                  role={message.role}
                  text={message.text}
                  avatarLabel={message.avatarLabel}
                  codeBlockId={message.id === codeAnchorId ? "code-block-copy" : undefined}
                  autoLoadRemoteImages={autoLoadRemoteImages}
                />
              </div>
              <div className="meta">
                <span className="agent-name">{who}</span>
                {handoffTo && <span className="handoff">via {handoffTo}</span>}
                {time && <span className="meta-time">{time}</span>}
                <MessageCost
                  usage={message.traceId ? usageByTrace[message.traceId] : undefined}
                  id={message.id === tourAnchorId ? "message-cost" : undefined}
                />
              </div>
            </div>
          );
        })}
        {liveStartedAt !== null && liveStartedAt !== undefined && (
          <LiveThinking startedAt={liveStartedAt} steps={liveSteps ?? []} />
        )}
        {approvalCard}
        {questionCard}
      </div>
      {!isAtBottom && (
        <button
          id="chat-jump-bottom"
          className="jump-bottom"
          type="button"
          aria-label="Jump to latest message"
          onClick={() => scrollToBottom()}
        >
          <TablerIcon name="ti-arrow-down" />
        </button>
      )}
      <ChatInputBar
        inputRef={inputRef}
        agentName={agentName}
        listening={listening}
        transcribing={transcribing}
        voiceEnabled={voiceEnabled}
        agents={agents}
        sendDisabled={sendDisabled}
        sendDisabledReason={sendDisabledReason}
        responding={responding}
        onSend={onSend}
        onStop={onStop}
        onStartVoice={onStartVoice}
        onStopVoice={onStopVoice}
      />
    </div>
  );
}
