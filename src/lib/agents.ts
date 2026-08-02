export type AgentId = string;

/** Mirrors the orchestrator's fixed `tools: [...]` array in buildOrchestrator()
 * (electron/main/ai/agents.ts) — the orchestrator has no AgentRow of its own (its
 * name/model come from settings), so this list is static rather than server-derived. */
export const ORCHESTRATOR_TOOL_NAMES = ["search_conversation_history", "get_current_location", "save_user_info"];

/**
 * A single step event in a run. Two sources: the main process forwards real SDK run items
 * over `agent:stream-step` (those carry the optional fields below), and AgentsApp
 * synthesises bookkeeping entries like "Message received" (type + label only). Everything
 * displayed is derived from one of those — never from what a model claims it did.
 * See buildActivityRows in lib/activityFeed.ts for how these become display rows.
 */
export interface StepEvent {
  type: string;
  /** Generic fallback text; a real tool name in `toolName` takes precedence when present. */
  label: string;
  /** When the main process received the event — pairs with `callId` to give a duration. */
  at?: number;
  toolName?: string;
  agentName?: string;
  callId?: string;
  /** On a handoff_occurred step: which agent the work went to. Deliberately not `agentName`
   * — buildActivityRows renders that as a prefix, which would read "Atlas Delegating to
   * Atlas" in the Thinking feed. Used by the turn's meta row to show a "via X" pill. */
  handoffTo?: string;
}

/**
 * active   — green, currently delegated/in use
 * standby  — purple, idle and ready
 * sleeping — gray, not currently in any state (default/unused)
 * error    — red, config/connection failure
 */
export type AgentStatus = "active" | "standby" | "sleeping" | "error";

export interface AgentLayoutItem extends AgentDisplayRow {
  angle: number;
  orbitTime: number;
  /** which radius band the node sits on — lets a large roster spread across 2 rings instead of overlapping on 1 */
  band: "inner" | "outer";
}

/** Assigns orbit position (angle/drift phase/radius band) to a fetched agent list — pure
 * layout math, has no opinion on which agents exist (that's `agent:list`'s job). */
export function computeAgentLayout(rows: AgentDisplayRow[]): AgentLayoutItem[] {
  const n = rows.length;
  return rows.map((row, i) => ({
    ...row,
    angle: (i / n) * Math.PI * 2 - Math.PI / 2,
    orbitTime: (i / n) * Math.PI * 2,
    band: i % 2 === 0 ? "inner" : "outer",
  }));
}

/** The single canonical way an agent's name becomes its slash-command slug (e.g. "Cipher"
 * -> "cipher", "Bank Analyst" -> "bank-analyst") — shared by the slash-menu generator
 * (ChatInputBar) and the deterministic-routing parser below, so the two never drift apart. */
export function slugifyAgentName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-");
}

/** Parses a leading "/<agent-slug> <message>" prefix off a chat input and resolves it
 * against the given (enabled) agents by slug — used to deterministically route a message
 * straight to that agent, bypassing the orchestrator's own handoff judgment. Returns null
 * when the input isn't in that shape, or its slug doesn't match any given agent (e.g. a
 * system command like "/settings", or an agent renamed/deleted since the slash menu opened). */
export function matchAgentSlashCommand<T extends { name: string }>(
  value: string,
  agents: T[]
): { agent: T; rest: string } | null {
  const match = value.match(/^\/([a-z0-9-]+)\s+([\s\S]+)$/i);
  if (!match) return null;
  const [, slug, rest] = match;
  const agent = agents.find((a) => slugifyAgentName(a.name) === slug.toLowerCase());
  return agent ? { agent, rest } : null;
}
