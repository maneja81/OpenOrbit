/**
 * Clock time for a chat turn's meta row, in the user's locale.
 *
 * Takes epoch ms (ChatMessage.createdAt). Deliberately separate from
 * ChatHistoryModal's formatTimestamp, which parses SQLite's zone-less
 * "YYYY-MM-DD HH:MM:SS" string and has to pin it to UTC first — different input,
 * different bug surface, so folding them together would help neither.
 *
 * Returns "" for a missing or unparseable stamp so the meta row simply omits the
 * time rather than printing "Invalid Date".
 */
export function formatMessageTime(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return "";
  return new Date(createdAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}
