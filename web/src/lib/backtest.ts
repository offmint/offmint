export interface BacktestDoc {
  id: string;
  event: { ticker: string; title: string; windowStart: string; p0: number; p0Source: string };
  summary: {
    ticker: string; p0Usd: number; bandUsd: [number, number]; maxPoolUsd: number; settlePoolUsd: number; headline: string;
    metaVault?: { assumptions: Record<string, unknown>; exFees: { sharesGainPct: number; priceMovePct: number; grossUsdPct: number; frictionPct: number; netUsdPct: number } };
    rows: { variant: string; deployed: number; avgSellUsd: number | null; vsHodlPct: number; vsHodlPctExFees: number; state: string }[];
  };
  sim: { timeline: { t: number; usd: number }[]; outliers?: unknown[] };
  caveats: string[];
}
export const EVENTS = ["hims-2026-08-28", "glxy-2026-09-11"] as const;
export async function loadBacktest(id: string): Promise<BacktestDoc> {
  const r = await fetch(`/data/backtest/${id}.json`);
  return r.json();
}
