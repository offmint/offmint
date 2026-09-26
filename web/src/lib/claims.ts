// Every number the landing page shows, derived from the published data files in web/public/data (never typed in).
// docs/AIRTIGHT.md ground rule 1; checked by web/test/claims.test.ts; ledger in docs/CLAIMS.md.
import weekends from "../../public/data/screen/weekends.json";
import weekday from "../../public/data/backtest/weekday-vs-weekend.json";
import params from "../../public/data/params.json";
import demo from "../../public/data/testnet/demo-meta.json";
import tests from "../../public/data/tests.json";
import hims from "../../public/data/backtest/hims-2026-08-28.json";
import glxy from "../../public/data/backtest/glxy-2026-09-11.json";
import fork from "../../public/data/sim/fork.json";
import replay from "../../public/data/supply/replay.json";

export interface Weekend { weekend: string; p0: number; p0Source: string; maxPremiumPct: number | null; premiumAtReopenPct?: number | null; hoursAbove10?: number; vaultVsHodlPctExFees?: number | null; note?: string }
const W = (weekends as any).tickers as Record<string, Weekend[]>;

export function weekendOf(ticker: string, date: string): Weekend {
  const w = W[ticker]?.find((x) => x.weekend === date);
  if (!w) throw new Error(`no screen data for ${ticker} ${date}`);
  return w;
}
export const maxOver = (tickers: string[]) =>
  Math.max(...tickers.flatMap((t) => (W[t] ?? []).map((w) => w.maxPremiumPct ?? -Infinity)));

export const SCREEN_SOURCE = (weekends as any).source as string;
export const SCREEN_REFERENCE = (weekends as any).reference as string;
export const SCREEN_WEEKENDS = [...new Set(Object.values(W).flat().map((w) => w.weekend))].sort();

/** The two replayed events: timeline from the backtest JSON, reference and peak from the weekend screen. */
export const EVENTS = [
  { ticker: "HIMS", doc: hims as any, screen: weekendOf("HIMS", "2026-08-29") },
  { ticker: "GLXY", doc: glxy as any, screen: weekendOf("GLXY", "2026-09-12") },
].map((e) => ({
  ...e,
  p0: e.screen.p0,
  peakUsd: Math.max(...(e.doc.sim.timeline as { usd: number }[]).filter((x) => x.usd < 1e6).map((x) => x.usd)),
  nyseClose: e.doc.event.p0Source?.startsWith("NYSE") ? Number(e.doc.event.p0) : null,
}));

/** Largest weekend premium by kind of token, all from the same screen (one linear scale). */
export const BARS = [
  { tickers: ["HIMS"], label: "HIMS", note: "new listing, no Chainlink feed · 29 Aug", pct: weekendOf("HIMS", "2026-08-29").maxPremiumPct!, hot: true },
  { tickers: ["MSTR"], label: "MSTR", note: "has a Chainlink feed · 29 Aug", pct: weekendOf("MSTR", "2026-08-29").maxPremiumPct!, hot: true },
  { tickers: ["GLXY"], label: "GLXY", note: "new listing, no Chainlink feed · 12 Sep", pct: weekendOf("GLXY", "2026-09-12").maxPremiumPct!, hot: true },
  { tickers: ["RKLB"], label: "RKLB", note: "has a Chainlink feed, any weekend", pct: maxOver(["RKLB"]) },
  { tickers: ["NVDA", "TSLA", "AAPL", "SPY"], label: "Large caps", note: "NVDA, TSLA, AAPL, SPY: highest of the four, any weekend", pct: maxOver(["NVDA", "TSLA", "AAPL", "SPY"]) },
  { tickers: ["HIMS"], label: "HIMS on weekdays", note: "95th percentile, minting on", pct: (weekday as any).tickers.HIMS.weekday.avgP95Pct as number },
];

export const LARGEST = Math.max(...Object.values(W).flat().map((w) => w.maxPremiumPct ?? -Infinity));
export const PARAMS = params;
export const LADDER = params.ladder.map((r) => [r.premiumBps / 100, (r.premiumBps + r.widthBps) / 100] as [number, number]);
export const DEMO = demo as any;
export const TESTS = tests;
export const pct = (bps: number) => `${bps / 100}%`;

/** Pinned mainnet-fork simulation (contracts/test/Fork.t.sol) for the worked example. */
export const FORK = fork as any;
export const WORKED = (() => {
  const g = FORK.tickers.GLXY;
  return { ...g, ticker: "GLXY", placed: g.rungs.map((r: any) => r.placed), usdg: g.rungs.map((r: any) => r.usdg), block: FORK.forkBlock };
})();

/**
 * The plain-English community-vault numbers (docs/DECISIONS.md D2), all from the with-supply replay (simulated):
 * per $1,000 of tokens deposited, our own orders in the pool, excluding LP fee income, after the 10% fee on profit.
 */
export const REPLAY = replay as any;
export const COMMUNITY = (() => {
  const size = "1000";
  const rows = (REPLAY.events as any[]).map((e) => ({ e, r: e.bySize[size].supply })).filter((x) => x.r);
  const filled = rows.filter((x) => x.r.usdgReceived > 0);
  const spikes = filled.filter((x) => x.e.loggedPeakPremiumPct >= 100).sort((a, b) => a.r.excessPctExLpFees - b.r.excessPctExLpFees);
  const worst = [...filled].sort((a, b) => a.r.excessPctExLpFees - b.r.excessPctExLpFees)[0];
  // buyback capacity: USDG the Monday buyback absorbed before hitting the cap, on the largest-size run that hit it
  const capped = (REPLAY.events as any[]).map((e) => e.bySize["100000"]?.supply).filter((r: any) => r && r.state === "PENDING_BUYBACK");
  const capacity = capped.map((r: any) => r.usdgReceived - r.usdgLeft).sort((a: number, b: number) => a - b);
  const noFill = rows.filter((x) => x.r.usdgReceived === 0);
  return {
    sizeUsd: Number(size),
    spike: { low: spikes[0], high: spikes.at(-1) },
    worst,
    normal: { count: noFill.length + (REPLAY.belowThresholdZero as number), gasUsd: REPLAY.gasUsdPerWeekend as number },
    screened: REPLAY.screenedTickerWeekends as number,
    feePct: params.vault.perfFeeBps / 100,
    capacityUsd: capacity.length ? capacity[Math.floor(capacity.length / 2)] : null,
    capacityMin: capacity.length ? capacity[0] : null,
    capacityMax: capacity.length ? (capacity.at(-1) as number) : null,
    capacityEvents: capacity.length,
    spikesPending: spikes.filter((x) => x.r.state === "PENDING_BUYBACK").length,
    spikeCount: spikes.length,
  };
})();
