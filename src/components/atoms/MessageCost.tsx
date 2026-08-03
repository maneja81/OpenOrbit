import { formatTokens, formatCost } from "@/lib/tokenFormat";

interface MessageCostProps {
  usage: TraceUsage | undefined;
  /** Set on the first costed message only, as the tour's anchor — see tourSteps.ts. */
  id?: string;
}

/**
 * What one reply cost, shown under its bubble. Renders nothing at all when there's no
 * usage for the run: messages predating migration 32 have no trace, the greeting was never
 * generated, and logTokenUsage is best-effort — none of those should leave a "$0" behind
 * implying the turn was free.
 */
export default function MessageCost({ usage, id }: MessageCostProps) {
  if (!usage || usage.totalTokens === 0) return null;
  const tokens = `${formatTokens(usage.totalTokens)} tok`;
  return (
    <div id={id} className="message-cost">
      {/* costUsd is null until the async OpenRouter lookup lands, so tokens show first and
          the price appears a beat later rather than the row flickering in wholesale. */}
      {usage.costUsd !== null && (
        // A local model costs nothing per token, and that is recorded as a real 0 rather than
        // left null. "$0.0000" reads as a price so small it rounded away; the true answer is that
        // there is no price, so say so. Deliberately not inside formatCost: the session total
        // sums with COALESCE(...,0), so a run where nothing could be priced also totals zero and
        // must not claim to have been free.
        <span className="message-cost-price">
          {usage.costUsd === 0 ? "Free" : formatCost(usage.costUsd)}
        </span>
      )}
      <span className="message-cost-tokens">{tokens}</span>
      {usage.calls > 1 && <span className="message-cost-calls">{usage.calls} calls</span>}
    </div>
  );
}
