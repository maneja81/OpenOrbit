import { beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

let db: Database.Database;

vi.mock("./index", () => ({
  getDb: () => db,
}));

import { insertTokenUsage, updateTokenUsageCost, queryUsageByTraceIds } from "./tokenUsageStore";

/** One LLM call inside a run. Defaults match the shape agent.ts's logTokenUsage writes. */
function logCall(traceId: string | null, overrides: Partial<Parameters<typeof insertTokenUsage>[0]> = {}): number {
  return insertTokenUsage({
    agentId: "Orbit",
    model: "gpt-4.1-mini",
    traceId,
    inputTokens: 100,
    outputTokens: 10,
    totalTokens: 110,
    generationId: null,
    ...overrides,
  });
}

describe("queryUsageByTraceIds", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
  });

  it("returns an empty map without querying when given no ids", () => {
    expect(queryUsageByTraceIds([])).toEqual({});
  });

  it("sums the several LLM calls that make up one run", () => {
    // A handoff turn spans more than one call — the message shows the whole turn's cost,
    // not just the last call's.
    logCall("trace-a", { totalTokens: 110 });
    logCall("trace-a", { totalTokens: 240 });

    expect(queryUsageByTraceIds(["trace-a"])).toEqual({
      "trace-a": { totalTokens: 350, costUsd: null, calls: 2 },
    });
  });

  it("keeps two runs apart", () => {
    logCall("trace-a", { totalTokens: 110 });
    logCall("trace-b", { totalTokens: 500 });

    const usage = queryUsageByTraceIds(["trace-a", "trace-b"]);
    expect(usage["trace-a"].totalTokens).toBe(110);
    expect(usage["trace-b"].totalTokens).toBe(500);
  });

  it("reports cost as null until the async lookup backfills it", () => {
    // insertTokenUsage never writes cost_usd — estimateGenerationCost fills it in later,
    // so "not known yet" has to stay distinguishable from "$0".
    const id = logCall("trace-a");
    expect(queryUsageByTraceIds(["trace-a"])["trace-a"].costUsd).toBeNull();

    updateTokenUsageCost(id, 0.0012);
    expect(queryUsageByTraceIds(["trace-a"])["trace-a"].costUsd).toBeCloseTo(0.0012);
  });

  it("sums cost across the calls that have one, ignoring those still pending", () => {
    const first = logCall("trace-a");
    const second = logCall("trace-a");
    logCall("trace-a"); // never costed — a failed/slow lookup
    updateTokenUsageCost(first, 0.001);
    updateTokenUsageCost(second, 0.002);

    expect(queryUsageByTraceIds(["trace-a"])["trace-a"].costUsd).toBeCloseTo(0.003);
  });

  it("omits a trace with no logged calls rather than zero-filling it", () => {
    // Messages written before migration 32 have no trace, and logTokenUsage swallows its
    // own failures — MessageCost keys off this absence to render nothing.
    expect(queryUsageByTraceIds(["never-logged"])).toEqual({});
  });

  it("ignores rows whose trace_id is null", () => {
    logCall(null);
    expect(queryUsageByTraceIds([""])).toEqual({});
  });

  it("drops blank ids and de-duplicates before querying", () => {
    logCall("trace-a");
    expect(queryUsageByTraceIds(["trace-a", "trace-a", ""])).toEqual({
      "trace-a": { totalTokens: 110, costUsd: null, calls: 1 },
    });
  });

  it("handles more ids than one SQL statement's parameter budget", () => {
    // Batched at 500; 1200 forces three round trips and would throw "too many SQL
    // variables" on an older SQLite if they were sent as one statement.
    const ids = Array.from({ length: 1200 }, (_, i) => `trace-${i}`);
    logCall("trace-0");
    logCall("trace-1199");

    const usage = queryUsageByTraceIds(ids);
    expect(Object.keys(usage).sort()).toEqual(["trace-0", "trace-1199"]);
  });
});
