import { ipcMain } from "electron";
import { getDb } from "../db";

export interface ChatMessageRecord {
  id: number;
  conversationId: number;
  role: string;
  text: string;
  agentId: string | null;
  /** Groups this message with the token_usage rows for the run that produced it. Only set
   * on assistant messages (a user message has no generation of its own to cost), and NULL
   * on anything written before migration 32. */
  traceId: string | null;
  createdAt: string;
}

const MESSAGE_COLUMNS = `
  id,
  conversation_id AS conversationId,
  role,
  text,
  agent_id AS agentId,
  trace_id AS traceId,
  created_at AS createdAt
`;

/** Module-private: every caller is in this file, and the conversation id it resolves is an
 * implementation detail of the queries below rather than part of the chat API. */
function getOrCreateDefaultConversation(): number {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM conversations ORDER BY id LIMIT 1").get() as
    | { id: number }
    | undefined;
  if (existing) return existing.id;
  const result = db.prepare("INSERT INTO conversations (title) VALUES (?)").run("Default");
  return result.lastInsertRowid as number;
}

export interface ChatMessagePage {
  messages: ChatMessageRecord[];
  /** Total messages in the conversation, so the caller can size its pager without
   * fetching every row. */
  total: number;
}

/**
 * One page of history, counted back from the newest message: page 0 is the most recent
 * `limit` messages, page 1 the `limit` before those. Rows within a page are returned
 * oldest-first so a turn still reads user-then-assistant.
 *
 * Paged in SQL rather than by slicing listMessages() — a long-running conversation
 * shouldn't have to cross the IPC boundary in full to show twenty rows.
 */
export function listMessagesPage(conversationId: number | undefined, limit: number, page: number): ChatMessagePage {
  const db = getDb();
  const cid = conversationId ?? getOrCreateDefaultConversation();
  // Clamped rather than trusted: these arrive from the renderer, and a negative OFFSET is
  // a SQL error while an unbounded LIMIT would defeat the point of paging.
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 1, 1), 100);
  const safePage = Math.max(Math.trunc(page) || 0, 0);

  const { total } = db.prepare("SELECT COUNT(*) AS total FROM messages WHERE conversation_id = ?").get(cid) as {
    total: number;
  };
  const rows = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(cid, safeLimit, safePage * safeLimit) as ChatMessageRecord[];

  return { messages: rows.reverse(), total };
}

/** Most recent `limit` messages for a conversation, in chronological (oldest-first) order. */
export function getRecentMessages(conversationId?: number, limit = 20): ChatMessageRecord[] {
  const db = getDb();
  const cid = conversationId ?? getOrCreateDefaultConversation();
  const rows = db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?`)
    .all(cid, limit) as ChatMessageRecord[];
  return rows.reverse();
}

export function appendMessage(message: {
  role: string;
  text: string;
  agentId?: string | null;
  traceId?: string | null;
  conversationId?: number;
}): ChatMessageRecord {
  if (message.role !== "user" && message.role !== "assistant") {
    throw new Error(`Invalid message role: "${message.role}"`);
  }
  if (typeof message.text !== "string" || message.text.length === 0) {
    throw new Error("Message text must be a non-empty string");
  }
  const db = getDb();
  const cid = message.conversationId ?? getOrCreateDefaultConversation();
  const result = db
    .prepare("INSERT INTO messages (conversation_id, role, text, agent_id, trace_id) VALUES (?, ?, ?, ?, ?)")
    .run(cid, message.role, message.text, message.agentId ?? null, message.traceId ?? null);
  return db
    .prepare(`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`)
    .get(result.lastInsertRowid) as ChatMessageRecord;
}

export function registerChatHistoryHandlers() {
  ipcMain.handle(
    "chat:listMessagesPage",
    (_event, limit: number, page: number, conversationId?: number): ChatMessagePage =>
      // limit/page are re-clamped inside listMessagesPage rather than here, so a
      // main-process caller gets the same bounds as the renderer.
      listMessagesPage(conversationId, limit, page)
  );

  ipcMain.handle(
    "chat:appendMessage",
    (
      _event,
      message: { role: string; text: string; agentId?: string | null; conversationId?: number }
    ): ChatMessageRecord =>
      // Rebuilt field-by-field rather than forwarded whole: traceId is deliberately not
      // accepted here. It keys into token_usage, so letting the renderer pick one would
      // let it point a message at another run's cost. Only agent.ts, which owns the run
      // that produced the id, sets it — by calling appendMessage directly.
      appendMessage({
        role: message.role,
        text: message.text,
        agentId: message.agentId,
        conversationId: message.conversationId,
      })
  );
}
