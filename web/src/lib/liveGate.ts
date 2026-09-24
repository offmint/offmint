// Quality gate for live premiums (docs/AIRTIGHT.md item 1, docs/verification/premiums.md).
// A premium is "verified" only if every check passes; otherwise it carries the reasons it is not.

export const GATE = {
  minTvlUsd: 10_000, // same floor as the detector
  maxImpact1kPct: 2, // a $1,000 swap must move the pool < 2%
  maxLastSwapAgeSec: 6 * 3600, // else "stale pool"
  maxRefSpreadPct: 1, // Robinhood quote bid/ask spread; wide quotes (market closed) make the mid meaningless
  maxIndependentDiffPct: 2, // pool price vs GeckoTerminal
} as const;

export interface GateInput {
  poolUsd: number | null;
  tvlUsd: number;
  depthUsdTo10: number; // USD needed to move the pool +10% (detector)
  lastSwapAgeSec: number | null;
  ref: { bid: number; ask: number; halted: boolean } | null; // token-adjusted (tokenBid/tokenAsk)
  independentUsd: number | null; // GeckoTerminal pool price; null = source unavailable
}

export interface GateResult {
  refUsd: number | null;
  premiumPct: number | null;
  impact1kPct: number | null;
  spreadPct: number | null;
  independentDiffPct: number | null;
  verified: boolean;
  reasons: string[];
}

/**
 * Token-adjusted reference price. Robinhood's /rhj/prices returns raw `bid`/`ask` (underlying share) and
 * `tokenBid`/`tokenAsk` (already x currentMultiplier). Use the token fields only: applying the multiplier again would
 * double-count it (e.g. CRWD, multiplier 4: bid 259.06 -> tokenBid 1036.24).
 */
export function tokenRef(q: { tokenBid?: string; tokenAsk?: string; isTradingHalt?: boolean }) {
  const bid = Number(q.tokenBid), ask = Number(q.tokenAsk);
  if (!(bid > 0) || !(ask > 0)) return null;
  return { bid, ask, halted: !!q.isTradingHalt };
}

export function gate(x: GateInput): GateResult {
  const reasons: string[] = [];
  const refUsd = x.ref ? (x.ref.bid + x.ref.ask) / 2 : null;
  const spreadPct = x.ref && refUsd ? ((x.ref.ask - x.ref.bid) / refUsd) * 100 : null;
  // price impact of $1k: concentrated liquidity is ~linear near the price, so scale the detector's $-to-10% figure
  const impact1kPct = x.depthUsdTo10 > 0 ? (10 * 1000) / x.depthUsdTo10 : null;
  const premiumPct = x.poolUsd && refUsd ? (x.poolUsd / refUsd - 1) * 100 : null;
  const independentDiffPct = x.poolUsd && x.independentUsd ? Math.abs(x.poolUsd / x.independentUsd - 1) * 100 : null;

  if (x.poolUsd === null) reasons.push("no pool price");
  if (x.tvlUsd < GATE.minTvlUsd) reasons.push(`pool TVL $${Math.round(x.tvlUsd)} < $${GATE.minTvlUsd}`);
  if (impact1kPct === null || impact1kPct >= GATE.maxImpact1kPct) reasons.push(`thin pool: $1k moves it ${impact1kPct?.toFixed(1) ?? "?"}%`);
  if (x.lastSwapAgeSec === null) reasons.push("no swap in the last 6 h (stale pool)");
  else if (x.lastSwapAgeSec > GATE.maxLastSwapAgeSec) reasons.push(`stale pool: last swap ${(x.lastSwapAgeSec / 3600).toFixed(1)} h ago`);
  if (!x.ref) reasons.push("no reference quote");
  else {
    if (x.ref.halted) reasons.push("reference: trading halt");
    if (spreadPct !== null && spreadPct > GATE.maxRefSpreadPct) reasons.push(`reference quote spread ${spreadPct.toFixed(1)}% (market likely closed)`);
  }
  if (x.independentUsd === null) reasons.push("independent price unavailable (GeckoTerminal)");
  else if (independentDiffPct !== null && independentDiffPct > GATE.maxIndependentDiffPct) {
    reasons.push(`pool price differs ${independentDiffPct.toFixed(1)}% from GeckoTerminal`);
  }
  return { refUsd, premiumPct, impact1kPct, spreadPct, independentDiffPct, verified: reasons.length === 0, reasons };
}
