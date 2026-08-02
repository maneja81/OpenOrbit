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
      {usage.costUsd !== null && <span className="message-cost-price">{formatCost(usage.costUsd)}</span>}
      <span className="message-cost-tokens">{tokens}</span>
      {usage.calls > 1 && <span className="message-cost-calls">{usage.calls} calls</span>}
    </div>
  );
}
