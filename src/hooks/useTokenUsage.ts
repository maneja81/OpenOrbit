import { useEffect, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

export type TokenUsageRange = NonNullable<TokenUsageFilter["range"]>;

const EMPTY_SUMMARY: TokenUsageSummary = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0, models: [] };

export function useTokenUsage(range: TokenUsageRange, model: string | null) {
  const [summary, setSummary] = useState<TokenUsageSummary>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    let cancelled = false;

    const fetchSummary = () => {
      window.agentsAPI.tokenUsage.get({ range, model }).then((data) => {
        if (!cancelled) setSummary(data);
      });
    };

    fetchSummary();
    const unsubscribe = window.agentsAPI.tokenUsage.onUpdate(fetchSummary);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [range, model]);

  return summary;
}
