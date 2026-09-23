// "Why only weekends?" — weekday vs weekend pool premiums for the curated tickers, from real Swap logs.
//   npm run weekday -w backtest [-- --weeks 8 --tickers INTC,HIMS]
// Weekend = Sat 00:00 -> Mon 00:00 UTC (minting closed): premium vs the frozen Friday Chainlink close.
// Weekday = Tue 00:00 -> Fri 00:00 UTC (minting open): premium vs the LIVE feed price at each swap (latest round <= swap).
// Per window: max premium, p95 premium, share of time spent above +5% / +10% (time-weighted, zero-liquidity prints excluded).
// Writes web/public/backtest/weekday-vs-weekend.json and docs/weekday-vs-weekend.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { makeClient, blockAtOrBefore, swapLogs, lastSwapBefore, type Round, type SwapLog } from "../../keeper/src/chain.js";
import { sqrtPriceX96ToUsd } from "../../keeper/src/rangeMath.js";
import { feedRounds, saturdays } from "./curate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DAY = 86_400;
const D8 = { feed: 8, stock: 18, usd: 6 };

export interface WindowStats {
  maxPct: number;
  p95Pct: number;
  timeAbove5Pct: number; // % of window time
  timeAbove10Pct: number;
  swaps: number;
}

/**
 * Time-weighted premium stats for a price path. `points` are (ts, premium) in time order; the premium holds until the
 * next point. The first point should be the state at `start` (e.g. the last swap before the window).
 */
export function windowStats(points: { t: number; prem: number }[], start: number, end: number, swaps: number): WindowStats {
  const seg: { dur: number; prem: number }[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = Math.max(points[i].t, start);
    const b = Math.min(i + 1 < points.length ? points[i + 1].t : end, end);
    if (b > a) seg.push({ dur: b - a, prem: points[i].prem });
  }
  const total = seg.reduce((s, x) => s + x.dur, 0) || 1;
  const sorted = [...seg].sort((x, y) => x.prem - y.prem);
  let acc = 0;
  let p95 = sorted.length ? sorted[sorted.length - 1].prem : 0;
  for (const x of sorted) {
    acc += x.dur;
    if (acc >= 0.95 * total) {
      p95 = x.prem;
      break;
    }
  }
  const r = (v: number) => Math.round(v * 1e4) / 100;
  return {
    maxPct: r(Math.max(0, ...points.filter((p) => p.t < end).map((p) => p.prem))),
    p95Pct: r(p95),
    timeAbove5Pct: Math.round((seg.filter((x) => x.prem >= 0.05).reduce((s, x) => s + x.dur, 0) / total) * 1e4) / 100,
    timeAbove10Pct: Math.round((seg.filter((x) => x.prem >= 0.1).reduce((s, x) => s + x.dur, 0) / total) * 1e4) / 100,
    swaps,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const weeks = Number(opt("--weeks") ?? 8);
  const facts = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8"));
  let tickers = opt("--tickers")?.split(",");
  if (!tickers) {
    const cur = JSON.parse(readFileSync(join(ROOT, "contracts/config/tickers.json"), "utf8"));
    tickers = Object.keys(cur.tickers);
  }
  tickers = tickers.filter((t) => facts.stocks[t]?.bestNoHookPool);
  const c = makeClient();
  const now = Number((await c.getBlock()).timestamp);
  const sats = saturdays(now - (weeks + 1) * 7 * DAY, now).slice(-weeks);
  console.log(`weekday vs weekend: ${tickers.join(", ")} x ${sats.length} weeks`);

  const rounds: Record<string, Round[]> = {};
  for (const t of tickers) if (facts.stocks[t].feed) rounds[t] = await feedRounds(c, facts.stocks[t].feed as Address, sats[0] - 7 * DAY);
  const pools = tickers.map((t) => facts.stocks[t].bestNoHookPool.poolId as Hex);
  const res: Record<string, { weekend: WindowStats[]; weekday: WindowStats[] }> = Object.fromEntries(tickers.map((t) => [t, { weekend: [], weekday: [] }]));

  for (const sat of sats) {
    const windows = [
      { kind: "weekday" as const, start: sat - 4 * DAY, end: sat - DAY }, // Tue 00:00 -> Fri 00:00 before this weekend
      { kind: "weekend" as const, start: sat, end: sat + 2 * DAY },
    ];
    for (const w of windows) {
      const [b0, b1] = [await blockAtOrBefore(c, w.start), await blockAtOrBefore(c, w.end)];
      const logs = await swapLogs(c, pools, b0, b1);
      for (const t of tickers) {
        const s = facts.stocks[t];
        const pl = logs.filter((l) => l.poolId.toLowerCase() === s.bestNoHookPool.poolId.toLowerCase() && l.liquidity > 0n);
        const before: SwapLog | undefined = await lastSwapBefore(c, s.bestNoHookPool.poolId as Hex, b0);
        const ref = (ts: number): number | null => {
          const r = rounds[t]?.filter((x) => x.updatedAt <= (w.kind === "weekend" ? w.start : ts)).at(-1);
          return r ? Number(r.answer) / 1e8 : null;
        };
        const usd = (l: SwapLog) => Number(sqrtPriceX96ToUsd(l.sqrtPriceX96, D8, s.stockIsCurrency0)) / 1e8;
        // no feed (e.g. HIMS): reference = pool price at window start (weekend) / 24h-lagged pool price (weekday)
        const pts: { t: number; prem: number }[] = [];
        const seq = [...(before ? [{ ...before, ts: w.start }] : []), ...pl];
        for (const l of seq) {
          const p0 = ref(l.ts) ?? (before ? usd(before) : null);
          if (p0) pts.push({ t: l.ts, prem: usd(l) / p0 - 1 });
        }
        res[t][w.kind].push(windowStats(pts, w.start, w.end, pl.length));
      }
      process.stdout.write(`${w.kind} ${new Date(w.start * 1000).toISOString().slice(0, 10)}: ${logs.length} swaps\n`);
    }
  }

  const summary: Record<string, any> = {};
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / (xs.length || 1)) * 100) / 100;
  for (const t of tickers) {
    const s = (k: "weekend" | "weekday") => ({
      maxPct: Math.max(0, ...res[t][k].map((x) => x.maxPct)),
      avgMaxPct: avg(res[t][k].map((x) => x.maxPct)),
      avgP95Pct: avg(res[t][k].map((x) => x.p95Pct)),
      avgTimeAbove10Pct: avg(res[t][k].map((x) => x.timeAbove10Pct)),
    });
    summary[t] = { hasFeed: !!facts.stocks[t].feed, weekend: s("weekend"), weekday: s("weekday"), weeks: res[t] };
  }
  const doc = {
    generatedAt: new Date().toISOString(),
    method:
      "Weekend premium vs the frozen Friday Chainlink close; weekday premium vs the live feed at each swap. Time-weighted, zero-liquidity prints excluded. Tickers without a feed use the pool's own window-start price.",
    weeks: sats.map((x) => new Date(x * 1000).toISOString().slice(0, 10)),
    tickers: summary,
  };
  const out = join(ROOT, "web/public/backtest/weekday-vs-weekend.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 1));
  const rows = Object.entries<any>(summary)
    .map(([t, v]) => `| ${t} | ${v.hasFeed ? "yes" : "no"} | +${v.weekday.maxPct}% | +${v.weekday.avgP95Pct}% | ${v.weekday.avgTimeAbove10Pct}% | **+${v.weekend.maxPct}%** | +${v.weekend.avgP95Pct}% | ${v.weekend.avgTimeAbove10Pct}% |`)
    .join("\n");
  writeFileSync(
    join(ROOT, "docs/weekday-vs-weekend.md"),
    `# Why only weekends? Weekday vs weekend premiums\n\n${doc.method}\nWeeks: ${doc.weeks[0]} .. ${doc.weeks.at(-1)}.\n\n| Ticker | Feed | Weekday max | Weekday p95 (avg) | Weekday time > +10% | Weekend max | Weekend p95 (avg) | Weekend time > +10% |\n|---|---|---|---|---|---|---|---|\n${rows}\n`,
  );
  console.log(JSON.stringify(Object.fromEntries(Object.entries<any>(summary).map(([t, v]) => [t, { weekdayMax: v.weekday.maxPct, weekendMax: v.weekend.maxPct }]))));
  console.log(`wrote ${out} and docs/weekday-vs-weekend.md`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
