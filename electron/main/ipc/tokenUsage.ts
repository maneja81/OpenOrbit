import { ipcMain } from "electron";
import {
  queryTokenUsage,
  queryDailyTokenUsage,
  queryUsageByTraceIds,
  TokenUsageFilter,
  TokenUsageSummary,
  DailyTokenUsage,
  TraceUsage,
} from "../db/tokenUsageStore";

export type { TokenUsageFilter, TokenUsageSummary, DailyTokenUsage, TraceUsage } from "../db/tokenUsageStore";

export function registerTokenUsageHandlers() {
  ipcMain.handle("tokenUsage:get", (_event, filter: TokenUsageFilter): TokenUsageSummary => queryTokenUsage(filter ?? {}));
  ipcMain.handle("tokenUsage:daily", (): DailyTokenUsage[] => queryDailyTokenUsage());
  // Read-only lookup, but the arg is still normalized here rather than trusted: a
  // non-array (or a renderer sending 10k ids) would otherwise reach the query builder.
  ipcMain.handle("tokenUsage:byTraces", (_event, traceIds: string[]): Record<string, TraceUsage> =>
    queryUsageByTraceIds(Array.isArray(traceIds) ? traceIds : [])
  );
}
