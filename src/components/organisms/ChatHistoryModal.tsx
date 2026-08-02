import { useMemo, useState } from "react";
import Modal from "@/components/atoms/Modal";
import TablerIcon from "@/components/atoms/TablerIcon";
import ChatBubble from "@/components/atoms/ChatBubble";
import MessageCost from "@/components/atoms/MessageCost";
import { useChatHistoryPage } from "@/hooks/useChatHistoryPage";
import { useTraceUsage } from "@/hooks/useTraceUsage";
import { CHAT_HISTORY_PAGE_SIZE, clampPage, pageRange, totalPages } from "@/lib/chatHistoryPage";
import { humanizeError, formatHumanizedError } from "@/lib/humanizeError";

interface ChatHistoryModalProps {
  open: boolean;
  onClose: () => void;
  /** Forwarded to every bubble — see AgentsSettings.remoteImagesAutoLoad. An archived reply
   * is no more trustworthy than a live one; the same image never fetched then should not
   * fetch now just because it is being re-read. */
  autoLoadRemoteImages?: boolean;
}

/** SQLite writes created_at as UTC "YYYY-MM-DD HH:MM:SS" with no zone marker, which
 * Date.parse reads as local time on some engines. Appending Z pins it to UTC so the
 * rendered local time is right rather than shifted by the machine's offset. */
function formatTimestamp(createdAt: string): string {
  const date = new Date(createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Mounted only while open (see AgentsApp), so `page` starts at 0 on every open without a
 * reset effect — reopening lands on the newest messages rather than resuming wherever the
 * last visit ended, which is what someone opening history actually wants. */
export default function ChatHistoryModal({ open, onClose, autoLoadRemoteImages }: ChatHistoryModalProps) {
  const [page, setPage] = useState(0);
  const { messages, total, loading, error } = useChatHistoryPage(open, page);

  const pageCount = totalPages(total, CHAT_HISTORY_PAGE_SIZE);
  // The page can outrun what exists if messages were removed between fetches; clamping on
  // render keeps the pager honest without a second round trip.
  const safePage = clampPage(page, total, CHAT_HISTORY_PAGE_SIZE);
  const range = pageRange(safePage, total, CHAT_HISTORY_PAGE_SIZE);

  const traceIds = useMemo(() => messages.map((m) => m.traceId ?? undefined), [messages]);
  const usageByTrace = useTraceUsage(traceIds);

  // Page 0 holds the newest messages, so "older" walks the page number up.
  const olderDisabled = loading || safePage >= pageCount - 1;
  const newerDisabled = loading || safePage <= 0;

  return (
    <Modal open={open} onClose={onClose} className="modal-panel--chat-history" label="Chat History">
      <div className="km-header">
        <span className="km-title">Chat History</span>
        <div className="widget-header-actions">
          <button className="widget-icon-btn" aria-label="Close" onClick={onClose}>
            <TablerIcon name="ti-x" />
          </button>
        </div>
      </div>
      <div className="km-body">
        {error && <p className="widget-empty">{formatHumanizedError(humanizeError(error))}</p>}
        {!error && loading && messages.length === 0 && <p className="widget-empty">Loading history…</p>}
        {!error && !loading && total === 0 && <p className="widget-empty">No messages yet.</p>}

        <div id="chat-history-list" className="ch-list">
          {messages.map((message) => {
            // ChatMessageRecord.role is a bare string; ChatBubble takes the "user" | "assistant" union.
            const isUser = message.role === "user";
            const who = isUser ? "You" : message.agentId || "Assistant";
            return (
              <div key={message.id} className={`ch-row ch-row--${message.role}`}>
                <div className="ch-meta">
                  <span className="ch-who">{who}</span>
                  <span className="ch-time">{formatTimestamp(message.createdAt)}</span>
                </div>
                <ChatBubble
                  role={isUser ? "user" : "assistant"}
                  text={message.text}
                  avatarLabel={who}
                  autoLoadRemoteImages={autoLoadRemoteImages}
                />
                <MessageCost usage={message.traceId ? usageByTrace[message.traceId] : undefined} />
              </div>
            );
          })}
        </div>
      </div>
      {total > 0 && (
        <div className="ch-pager">
          <button
            className="ch-pager-btn"
            onClick={() => setPage(safePage + 1)}
            disabled={olderDisabled}
            aria-label="Older messages"
          >
            <TablerIcon name="ti-chevron-left" />
            <span>Older</span>
          </button>
          <span className="ch-pager-status">
            {range.start}–{range.end} of {total}
          </span>
          <button
            className="ch-pager-btn"
            onClick={() => setPage(safePage - 1)}
            disabled={newerDisabled}
            aria-label="Newer messages"
          >
            <span>Newer</span>
            <TablerIcon name="ti-chevron-right" />
          </button>
        </div>
      )}
    </Modal>
  );
}
