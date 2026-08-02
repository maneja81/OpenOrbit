import { useEffect, useMemo, useState } from "react";
import { hasAgentsAPI } from "@/lib/agentsApi";

const EMPTY: Record<string, TraceUsage> = {};

/**
 * Usage for every run represented in the chat log, keyed by trace id.
 *
 * One batched query for the whole list rather than one per message: this re-runs on every
 * tokenUsage:update broadcast, which main fires twice per LLM call (once on insert, once
 * when the async cost lookup backfills), so a per-message fetch would multiply out to
 * hundreds of round trips in a long conversation.
 *
 * Re-subscribing is what makes cost appear at all — a row's cost_usd is NULL when the
 * message is first rendered and is filled in a moment later.
 */
export function useTraceUsage(traceIds: (string | undefined)[]): Record<string, TraceUsage> {
  const [usage, setUsage] = useState<Record<string, TraceUsage>>(EMPTY);

  // Join into a stable primitive so the effect re-runs when the set of traces actually
  // changes, not on every render (a fresh array literal would never compare equal).
  const key = useMemo(() => traceIds.filter((id): id is string => !!id).join(","), [traceIds]);

  useEffect(() => {
    if (!hasAgentsAPI()) return;
    const ids = key.length > 0 ? key.split(",") : [];
    // Nothing to look up. Any previously-fetched entries are left in place rather than
    // cleared: the map is only ever read as usage[message.traceId], so keys for traces
    // that are no longer on screen can't be displayed, and clearing here would mean
    // calling setState straight from the effect body for no visible gain.
    if (ids.length === 0) return;
    let cancelled = false;

    const fetchUsage = () => {
      window.agentsAPI.tokenUsage
        .byTraces(ids)
        .then((data) => {
          if (!cancelled) setUsage(data);
        })
        .catch(() => {
          // A failed cost lookup must never blank the chat log — the previous values stay
          // on screen and the next broadcast retries.
        });
    };

    fetchUsage();
    const unsubscribe = window.agentsAPI.tokenUsage.onUpdate(fetchUsage);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  return usage;
}
