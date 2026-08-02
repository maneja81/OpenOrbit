/** Token and cost formatting shared by the Agent Activity & Usage widget and the
 * per-message cost line. Extracted from TokenUsageWidget when the second caller appeared —
 * the two surfaces must read identically, so "50.7K" in the widget and "50.7K" under a
 * message can't drift apart. */

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Sub-dollar amounts get 4 decimals because a single turn is often a fraction of a cent —
 * $0.00 would read as free. */
export function formatCost(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
