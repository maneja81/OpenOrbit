/**
 * Conversation-history search tool — lets the orchestrator look back through past
 * chat turns by keyword, e.g. to answer "what did we do last week?". Attached only to
 * the orchestrator, not the ConfigAgent/KnowledgeAgent sub-agents: it's a pure function
 * over the DB (not ipcMain, wrong process layer), matching the pattern in
 * tools/knowledgeAgentTools.ts.
 */

import { tool } from "@openai/agents";
import { z } from "zod";
import { getDb } from "../../db";

export const searchHistoryTool = tool({
  name: "search_conversation_history",
  description:
    "Search past conversation messages (both the user's and yours) for a keyword or phrase. Use this when the user references something from an earlier conversation you don't have in your current context, e.g. \"what did we do last week?\" or \"what was that thing I mentioned about X?\". Returns up to the 5 most recent matching messages.",
  parameters: z.object({
    query: z.string().min(1).max(200).describe("Keyword or phrase to search for in past messages."),
  }),
  execute: async ({ query }) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, role, text, agent_id AS agentId, created_at AS createdAt
         FROM messages
         WHERE text LIKE ?
         ORDER BY created_at DESC
         LIMIT 5`
      )
      .all(`%${query}%`) as {
      id: number;
      role: string;
      text: string;
      agentId: string | null;
      createdAt: string;
    }[];
    return { total: rows.length, messages: rows };
  },
});
