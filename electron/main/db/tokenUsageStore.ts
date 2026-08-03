import { getDb } from "./index";

export interface TokenUsageInsert {
  agentId: string | null;
  model: string;
  traceId: string | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  generationId: string | null;
}

export interface TokenUsageFilter {
  range?: "today" | "week" | "all";
  model?: string | null;
}

export interface TokenUsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  models: string[];
}

const RANGE_CLAUSES: Record<NonNullable<TokenUsageFilter["range"]>, string> = {
  today: "AND created_at >= datetime('now', 'start of day')",
  week: "AND created_at >= datetime('now', '-7 days')",
  all: "",
};

export function insertTokenUsage(row: TokenUsageInsert): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO token_usage (agent_id, model, trace_id, input_tokens, output_tokens, total_tokens, generation_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(row.agentId, row.model, row.traceId, row.inputTokens, row.outputTokens, row.totalTokens, row.generationId);
  return result.lastInsertRowid as number;
}

export function updateTokenUsageCost(id: number, costUsd: number): void {
  const db = getDb();
  db.prepare("UPDATE token_usage SET cost_usd = ? WHERE id = ?").run(costUsd, id);
}

export interface DailyTokenUsage {
  /** YYYY-MM-DD, local to the machine running the main process. */
  date: string;
  totalTokens: number;
}

// Last 7 calendar days (today inclusive), local time, oldest first — always returns all
// 7 entries even for days with zero usage so callers can render a fixed-width week chart.
export function queryDailyTokenUsage(): DailyTokenUsage[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT date(created_at, 'localtime') AS date, COALESCE(SUM(total_tokens), 0) AS totalTokens
       FROM token_usage
       WHERE created_at >= datetime('now', '-6 days', 'start of day')
       GROUP BY date`
    )
    .all() as DailyTokenUsage[];
  const byDate = new Map(rows.map((r) => [r.date, r.totalTokens]));

  const result: DailyTokenUsage[] = [];
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    result.push({ date, totalTokens: byDate.get(date) ?? 0 });
  }
  return result;
}

/** What one run (one trace_id) cost, aggregated over the several LLM calls it spans. */
export interface TraceUsage {
  totalTokens: number;
  /** null until the async OpenRouter lookup backfills a cost (see updateTokenUsageCost) —
   * distinct from 0, which would claim the run was free. Callers render the difference. */
  costUsd: number | null;
  /** How many LLM calls the run made. A handoff turn spans more than one. */
  calls: number;
}

// SQLite's default parameter ceiling is 999 on older builds; batching keeps a long chat
// from ever hitting it. 500 leaves margin without making the round trips meaningfully
// more frequent.
const TRACE_QUERY_BATCH_SIZE = 500;

/**
 * Usage for a set of runs, keyed by trace_id. Batched rather than one call per message so
 * a chat log of N messages costs one IPC round trip, not N — the renderer re-queries this
 * on every tokenUsage:update broadcast, which fires twice per LLM call.
 *
 * A trace with no rows is simply absent from the result: usage logging is best-effort
 * (logTokenUsage swallows its own errors), and messages written before migration 32 have
 * no trace at all.
 */
export function queryUsageByTraceIds(traceIds: string[]): Record<string, TraceUsage> {
  const unique = [...new Set(traceIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (unique.length === 0) return {};

  const db = getDb();
  const result: Record<string, TraceUsage> = {};
  for (let i = 0; i < unique.length; i += TRACE_QUERY_BATCH_SIZE) {
    const batch = unique.slice(i, i + TRACE_QUERY_BATCH_SIZE);
    const rows = db
      .prepare(
        `SELECT
           trace_id AS traceId,
           COALESCE(SUM(total_tokens), 0) AS totalTokens,
           SUM(cost_usd) AS costUsd,
           COUNT(*) AS calls
         FROM token_usage
         WHERE trace_id IN (${batch.map(() => "?").join(", ")})
         GROUP BY trace_id`
      )
      .all(...batch) as (TraceUsage & { traceId: string })[];
    for (const row of rows) {
      result[row.traceId] = { totalTokens: row.totalTokens, costUsd: row.costUsd, calls: row.calls };
    }
  }
  return result;
}

export function queryTokenUsage(filter: TokenUsageFilter): TokenUsageSummary {
  const db = getDb();
  const range = filter.range ?? "all";
  const rangeClause = RANGE_CLAUSES[range];
  const modelClause = filter.model ? "AND model = ?" : "";
  const params: string[] = filter.model ? [filter.model] : [];

  const summary = db
    .prepare(
      `SELECT
         COALESCE(SUM(input_tokens), 0) AS inputTokens,
         COALESCE(SUM(output_tokens), 0) AS outputTokens,
         COALESCE(SUM(total_tokens), 0) AS totalTokens,
         COALESCE(SUM(cost_usd), 0) AS costUsd
       FROM token_usage
       WHERE 1 = 1 ${rangeClause} ${modelClause}`
    )
    .get(...params) as { inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number };

  const models = (db.prepare("SELECT DISTINCT model FROM token_usage ORDER BY model").all() as { model: string }[]).map(
    (r) => r.model
  );

  return { ...summary, models };
}
