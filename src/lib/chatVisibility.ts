import type { MessageRole } from "@/components/atoms/ChatBubble";

/** The minimal shape sliceRecentConversations needs — ChatPanel's ChatMessage satisfies this,
 * kept structural rather than importing that type to avoid a dependency back onto the
 * component from a pure lib helper. */
export interface ConversationMessage {
  role: MessageRole;
}

/**
 * Keeps the last `count` conversations — a user message and everything up to (not including)
 * the next one — rather than a flat message count. A turn can produce more than one message
 * (streamed reply, a config-ack notice, an onboarding-failure follow-up), so a flat cap could
 * split a single conversation across the "visible" boundary; this always keeps whole ones.
 *
 * `count <= 0` returns everything after the last user message with no conversation at all if
 * one hasn't started yet, i.e. every message, matching "not started" rather than "hide
 * everything" — that only happens when `count` is a stored value below its own schema minimum
 * of 1, which validateSettingValue already refuses to persist.
 *
 * Fewer than `count` user turns exist in the whole list — returns everything, including any
 * leading assistant-only messages (the entrance greeting) that precede the first user turn.
 */
export function sliceRecentConversations<T extends ConversationMessage>(messages: T[], count: number): T[] {
  if (count <= 0) return messages;
  let userTurnsSeen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "user") continue;
    userTurnsSeen++;
    if (userTurnsSeen === count) return messages.slice(i);
  }
  return messages;
}
