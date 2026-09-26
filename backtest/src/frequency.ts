// Premium frequency (docs/TAILOR.md Phase 1 item 4): how often do mint-off premiums exceed 2%, 5%, 10%, 25%?
//   npm run frequency -w backtest      (after `npm run harm`: reuses its swap cache and reference closes)
// Per (ticker, mint-off window): the ticker's most active tracking pool (hook-free USDG, fee <= 1%, last pre-window price
// within 10% of the reference close), pool price vs the reference close. Two measures per threshold:
//   peak      — any print above it (zero-liquidity drain prints excluded)
//   sustained — above it for >= 1 hour in total (each print held until the next one)
// Universes: every active ticker-window (>= 10 swaps in the window), and "eligible" = the Bitget/detector floor:
// >= $10,000 of USDG needed to move the pool +10% at the window start. Writes web/public/data/frequency.json.
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeClient, blockTime } from "../../keeper/src/chain.js";
import { mintOffWindows } from "./window.js";
import { tickerWindows, loadPools, loadCloses, loadWindowLogs, MIN_SWAPS } from "./tickerWindows.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const THRESHOLDS = [2, 5, 10, 25];
const MIN_DEPTH_USD = 10_000;
const SUSTAIN_H = 1;
const since = "2026-07-01";

const c = makeClient();
const head = Number((await c.getBlock()).timestamp);
const latest = await c.getBlockNumber();
const windows = mintOffWindows(Date.parse(`${since}T00:00:00Z`) / 1000, head);
const pools = loadPools();
const closes = loadCloses(since);
const timeOf = (b: number) => blockTime(c, BigInt(b), latest);

type Row = { ticker: string; window: string; swaps: number; depthUsd: number | null; peakPct: number; hoursAbove: Record<number, number> };
const rows: Row[] = [];
for (const w of windows) {
  const tw = await tickerWindows(w, loadWindowLogs(w), pools, closes, timeOf);
  for (const r of tw) if (r.active) rows.push({ ticker: r.ticker, window: r.window, swaps: r.mainPoolSwaps, depthUsd: r.depthUsd, peakPct: r.peakPct, hoursAbove: r.hoursAbove });
  console.error(`${w.label}: ${tw.length} tickers with a tracking pool, ${tw.filter((r) => r.active).length} active`);
}

function table(rs: Row[]) {
  const ws = [...new Set(rs.map((r) => r.window))];
  return {
    tickerWindows: rs.length,
    tickers: new Set(rs.map((r) => r.ticker)).size,
    windows: ws.length,
    byThreshold: THRESHOLDS.map((th) => {
      const peak = rs.filter((r) => r.peakPct >= th);
      const sus = rs.filter((r) => r.hoursAbove[th] >= SUSTAIN_H);
      const pct = (n: number) => (rs.length ? Math.round((n / rs.length) * 1000) / 10 : null);
      return {
        thresholdPct: th,
        peakCount: peak.length, peakSharePct: pct(peak.length),
        sustainedCount: sus.length, sustainedSharePct: pct(sus.length),
        windowsWithAnySustained: new Set(sus.map((r) => r.window)).size,
        windowsWithAnySustainedSharePct: ws.length ? Math.round((new Set(sus.map((r) => r.window)).size / ws.length) * 1000) / 10 : null,
      };
    }),
  };
}
const eligible = rows.filter((r) => (r.depthUsd ?? 0) >= MIN_DEPTH_USD);
const out = {
  generatedAt: new Date().toISOString(),
  label: "observed (onchain swaps vs official closes)",
  method: [
    "Same windows, pools and reference closes as web/public/data/harm.json.",
    `Per ticker-window: the most active tracking pool; windows with fewer than ${MIN_SWAPS} swaps are left out as untradeable.`,
    "peak = the premium held for at least 15 minutes reached the threshold (single stray prints are ignored). sustained = at or above it for at least 1 hour in total.",
    `eligible = at least $${MIN_DEPTH_USD.toLocaleString()} of USDG needed to move the pool +10% at the window start (the detector's floor).`,
    "Block times are interpolated between anchor blocks (error of a few minutes).",
  ],
  thresholdsPct: THRESHOLDS,
  sustainHours: SUSTAIN_H,
  all: table(rows),
  eligible: table(eligible),
  events25: rows.filter((r) => r.hoursAbove[25] >= SUSTAIN_H).sort((a, b) => b.peakPct - a.peakPct).map((r) => ({ ticker: r.ticker, window: r.window, peakPct: r.peakPct, hoursAbove25: r.hoursAbove[25], depthUsd: r.depthUsd })),
  rows,
};
writeFileSync(join(ROOT, "web/public/data/frequency.json"), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ all: out.all.byThreshold, eligible: out.eligible.byThreshold }, null, 1));
console.log("wrote web/public/data/frequency.json");
