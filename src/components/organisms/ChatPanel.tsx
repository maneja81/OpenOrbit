import { ReactNode, RefObject, useState } from "react";
import ChatBubble, { MessageRole } from "@/components/atoms/ChatBubble";
import ChatInputBar, { DirectableAgent } from "@/components/molecules/ChatInputBar";
import TablerIcon from "@/components/atoms/TablerIcon";
import { StepEvent } from "@/lib/agents";
import { buildActivityRows, formatStepDuration } from "@/lib/activityFeed";
import { formatMessageTime } from "@/lib/chatTime";
import { hasCodeFence } from "@/lib/codeFence";
import MessageCost from "@/components/atoms/MessageCost";
import { useTraceUsage } from "@/hooks/useTraceUsage";
import { useScrollToBottom } from "@/hooks/useScrollToBottom";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  text: string;
  avatarLabel: string;
  // Only set on assistant messages — the hand-off narration captured for that turn
  // (see THINKING_STEP_TYPES in AgentsApp.tsx), shown as a minimal toggle line.
  steps?: StepEvent[];
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
  /** True while an approval or a question is outstanding — blocks sending so a second turn
   * can't start a concurrent run against a conversation that's mid-approval/mid-question. */
  sendDisabled?: boolean;
  /** KI-3: which kind blocked it, forwarded to ChatInputBar so its placeholder describes
   * the actual pause instead of always assuming an approval gate. */
  sendDisabledReason?: "approval" | "question";
  /** Opens the full paged archive (ChatHistoryModal) — the log itself only keeps the last
   * MAX_VISIBLE_MESSAGES turns on screen. */
  onShowFullHistory: () => void;
  /** Forwarded to every bubble — see AgentsSettings.remoteImagesAutoLoad. */
  autoLoadRemoteImages?: boolean;
  onSend: () => void;
  onStartVoice: () => void;
  onStopVoice: () => void;
}

/** Enough backlog to follow a conversation without the log growing tall enough to bury the
 * orbit behind it. Everything older stays one click away in ChatHistoryModal. */
const MAX_VISIBLE_MESSAGES = 10;

/** Minimal text+chevron toggle for a turn's hand-off narration — deliberately not the
 * full WidgetCard glass-panel shell (title bar, padding, border) used elsewhere, since
 * this is meant to read as a small inline disclosure, not another panel. */
function ThinkingToggle({ steps }: { steps: StepEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-toggle">
      <button type="button" className="thinking-toggle-btn" onClick={() => setOpen((o) => !o)}>
        <TablerIcon name={open ? "ti-chevron-down" : "ti-chevron-right"} />
        <span>Thinking</span>
      </button>
      {open && (
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
      )}
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
  sendDisabled,
  sendDisabledReason,
  onShowFullHistory,
  autoLoadRemoteImages,
  onSend,
  onStartVoice,
  onStopVoice,
}: ChatPanelProps) {
  const { containerRef, isAtBottom, scrollToBottom } = useScrollToBottom<HTMLDivElement>();

  // The tail of the conversation rather than the whole of it — see MAX_VISIBLE_MESSAGES.
  const visible = messages.slice(-MAX_VISIBLE_MESSAGES);
  const hasOlder = messages.length > MAX_VISIBLE_MESSAGES;

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
              {message.steps && message.steps.length > 0 && <ThinkingToggle steps={message.steps} />}
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
        onSend={onSend}
        onStartVoice={onStartVoice}
        onStopVoice={onStopVoice}
      />
    </div>
  );
}
