import { useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";
import { CHAT_HISTORY_PAGE_SIZE } from "@/lib/chatHistoryPage";

interface ChatHistoryPageState {
  messages: ChatMessageRecord[];
  total: number;
  loading: boolean;
  error: string | null;
}

/** What came back, tagged with the page it came back for. Tagging is what lets `loading`
 * be derived rather than stored — a flag set in the effect body would mean calling
 * setState straight from an effect, which cascades a render for no added information. */
interface FetchedPage {
  page: number;
  messages: ChatMessageRecord[];
  total: number;
  error: string | null;
}

/**
 * One page of persisted chat history. Fetches only while `open` so the modal costs nothing
 * when closed, and re-fetches on page change.
 *
 * Deliberately not subscribed to new-message events: history is a look backwards, and
 * having rows shift underneath while reading would move the page the user is on.
 */
export function useChatHistoryPage(open: boolean, page: number): ChatHistoryPageState {
  const [fetched, setFetched] = useState<FetchedPage | null>(null);

  useEffect(() => {
    if (!open || !hasAgentsAPI()) return;
    let cancelled = false;

    window.agentsAPI.chat
      .listMessagesPage(CHAT_HISTORY_PAGE_SIZE, page)
      .then((result) => {
        if (cancelled) return;
        setFetched({ page, messages: result.messages, total: result.total, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Kept raw for the modal to humanize — this hook has no opinion on copy.
        setFetched({ page, messages: [], total: 0, error: String(err) });
      });

    return () => {
      cancelled = true;
    };
  }, [open, page]);

  const isCurrent = fetched !== null && fetched.page === page;

  return {
    // The previous page's rows stay on screen while the next one loads, so paging doesn't
    // flash empty between clicks.
    messages: fetched?.messages ?? [],
    total: fetched?.total ?? 0,
    loading: open && !isCurrent,
    // Only surfaced once it belongs to the page being asked about, so a stale failure
    // doesn't sit over a page that has since loaded fine.
    error: isCurrent ? fetched.error : null,
  };
}
