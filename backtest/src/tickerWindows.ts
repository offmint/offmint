// Per (mint-off window, ticker) statistics from the harm scan's cache (backtest/.cache/harm), with exactly the harm
// scan's rules: hook-free STOCK/USDG pools with fee <= 1%, a pool counts for a window only if its last pre-window price is
// within 10% of the reference close, a buy = stock to the trader for USDG, paid price includes the pool fee.
// Shared by frequency.ts and weekends.ts so the weekend report, the frequency table and harm.json cannot disagree.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Window } from "./window.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const CACHE = join(ROOT, "backtest/.cache/harm");
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ZERO = "0x0000000000000000000000000000000000000000";
export const OFF_REF_PCT = 10;
export const BUY_THRESHOLDS = [0, 2, 5, 10];
export const HOUR_THRESHOLDS = [2, 5, 10, 25];
export const MIN_SWAPS = 10;
export const HELD_S = 15 * 60;

/**
 * Highest level the price stayed at or above for `held` seconds. `path` is a step function (each premium holds until
 * the next point; the last holds until `end`). A one-print spike into a near-empty tick range (SNDK 18 Jul "+2,023%",
 * DJT 29 Aug) lasts seconds and is ignored; a real squeeze (HIMS 29 Aug held +25% for over an hour) is kept.
 */
export function heldPeak(path: { t: number; prem: number }[], end: number, held: number): number {
  let best = -Infinity;
  for (let i = 0; i < path.length; i++) {
    const until = path[i].t + held;
    if (until > end) break;
    let lo = path[i].prem;
    for (let j = i + 1; j < path.length && path[j].t < until; j++) lo = Math.min(lo, path[j].prem);
    best = Math.max(best, lo);
  }
  return Number.isFinite(best) ? best : path[0].prem;
}

export interface Log { poolId: string; block: number; tx: string; amount0: bigint; amount1: bigint; sqrtPriceX96: bigint; liquidity: bigint; pre?: boolean }
export interface TickerWindow {
  ticker: string;
  window: string;
  refDate: string;
  reference: number;
  trackingPools: number;
  mainPool: string;
  mainPoolSwaps: number; // in-window swaps in the most active tracking pool
  active: boolean; // >= MIN_SWAPS in the main pool
  depthUsd: number | null; // USDG to move the main pool +10% at the window start
  peakPct: number; // highest premium the main pool HELD for 15 minutes (a single stray print is not a price anyone traded at)
  hoursAbove: Record<number, number>; // main pool at/above each threshold, hours
  lastPrice: { block: number; sqrtPriceX96: bigint } | null; // main pool, last in-window print (for recovery)
  stockIs0: boolean;
  buys: Record<number, { swaps: number; usdAbove: number; txs: string[] }>; // all tracking pools, per threshold
}

export function loadPools(): Map<string, { ticker: string; stockIs0: boolean }> {
  const pools = new Map<string, { ticker: string; stockIs0: boolean }>();
  for (const [ticker, ps] of Object.entries<any[]>(JSON.parse(readFileSync(join(ROOT, "backtest/.cache/pools.json"), "utf8"))))
    for (const p of ps) if (p.quote.toLowerCase() === USDG && p.hooks.toLowerCase() === ZERO && p.fee <= 10_000) pools.set(p.poolId.toLowerCase(), { ticker, stockIs0: p.stockIs0 });
  return pools;
}
export const loadCloses = (since: string) => JSON.parse(readFileSync(join(CACHE, `closes-${since}.json`), "utf8")) as Record<string, Record<string, number>>;
export function loadWindowLogs(w: Window): Log[] {
  const path = join(CACHE, `swaps-${w.start}-${w.end}.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}: run npm run harm first`);
  return (JSON.parse(readFileSync(path, "utf8")) as any[]).map((l) => ({ ...l, amount0: BigInt(l.amount0), amount1: BigInt(l.amount1), sqrtPriceX96: BigInt(l.sqrtPriceX96), liquidity: BigInt(l.liquidity ?? 0) }));
}
export const usdOf = (sq: bigint, s0: boolean) => { const s = Number(sq) / 2 ** 96; return s0 ? s * s * 1e12 : 1e12 / (s * s); };
/** USDG needed to move the price +10% with active liquidity L (single-range approximation). */
export function depthTo10(L: bigint, usd: number, s0: boolean): number {
  const S = (u: number) => (s0 ? Math.sqrt(u / 1e12) : Math.sqrt(1e12 / u));
  const [a, b] = [S(usd), S(usd * 1.1)];
  const l = Number(L);
  return (s0 ? l * (b - a) : l * Math.abs(1 / b - 1 / a)) / 1e6;
}

/** All ticker rows for one window. `timeOf` maps a block to a unix time (interpolated). */
export async function tickerWindows(w: Window, logs: Log[], pools: ReturnType<typeof loadPools>, closes: ReturnType<typeof loadCloses>, timeOf: (b: number) => Promise<number>): Promise<TickerWindow[]> {
  const byPool = new Map<string, Log[]>();
  for (const l of logs) (byPool.get(l.poolId) ?? byPool.set(l.poolId, []).get(l.poolId)!).push(l);
  const tracking = new Map<string, string[]>(); // ticker -> pools
  for (const [id, ls] of byPool) {
    const p = pools.get(id);
    const ref = p && closes[p.ticker]?.[w.refDate];
    if (!p || !ref) continue;
    const pre = ls.filter((l) => l.pre).at(-1) ?? ls.find((l) => !l.pre)!;
    if (Math.abs(usdOf(pre.sqrtPriceX96, p.stockIs0) / ref - 1) * 100 > OFF_REF_PCT) continue;
    (tracking.get(p.ticker) ?? tracking.set(p.ticker, []).get(p.ticker)!).push(id);
  }
  const rows: TickerWindow[] = [];
  for (const [ticker, ids] of tracking) {
    const ref = closes[ticker][w.refDate];
    const s0 = pools.get(ids[0])!.stockIs0;
    const buys = Object.fromEntries(BUY_THRESHOLDS.map((t) => [t, { swaps: 0, usdAbove: 0, txs: [] as string[] }]));
    for (const id of ids) {
      const ps0 = pools.get(id)!.stockIs0;
      for (const l of byPool.get(id)!) {
        if (l.pre) continue;
        const [stk, usd] = ps0 ? [l.amount0, l.amount1] : [l.amount1, l.amount0];
        if (!(stk > 0n && usd < 0n)) continue;
        const stock = Number(stk) / 1e18, paid = Number(-usd) / 1e6;
        if (stock <= 0 || paid < 0.01) continue;
        const prem = (paid / stock / ref - 1) * 100;
        for (const t of BUY_THRESHOLDS) if (prem > t) { buys[t].swaps++; buys[t].usdAbove += paid - stock * ref; buys[t].txs.push(l.tx); }
      }
    }
    // main pool: most in-window swaps
    const main = ids.map((id) => [id, byPool.get(id)!.filter((l) => !l.pre).length] as const).sort((a, b) => b[1] - a[1])[0];
    const ls = byPool.get(main[0])!;
    const ms0 = pools.get(main[0])!.stockIs0;
    const pre = ls.filter((l) => l.pre).at(-1);
    const inWin = ls.filter((l) => !l.pre && l.liquidity > 0n);
    const startPrem = pre ? usdOf(pre.sqrtPriceX96, ms0) / ref - 1 : -1;
    const above = Object.fromEntries(HOUR_THRESHOLDS.map((t) => [t, 0])) as Record<number, number>;
    const path: { t: number; prem: number }[] = [{ t: w.start, prem: startPrem }];
    let prevT = w.start;
    let prevPrem = startPrem;
    for (const l of inWin) {
      const t = Math.min(Math.max(await timeOf(l.block), w.start), w.end);
      for (const th of HOUR_THRESHOLDS) if (prevPrem * 100 >= th) above[th] += Math.max(0, t - prevT);
      prevT = Math.max(prevT, t);
      prevPrem = usdOf(l.sqrtPriceX96, ms0) / ref - 1;
      path.push({ t: prevT, prem: prevPrem });
    }
    for (const th of HOUR_THRESHOLDS) if (prevPrem * 100 >= th) above[th] += Math.max(0, w.end - prevT);
    const peak = heldPeak(path, w.end, HELD_S);
    const last = inWin.at(-1);
    rows.push({
      ticker, window: w.label, refDate: w.refDate, reference: ref, trackingPools: ids.length, mainPool: main[0], mainPoolSwaps: main[1],
      active: main[1] >= MIN_SWAPS,
      depthUsd: pre && pre.liquidity > 0n ? Math.round(depthTo10(pre.liquidity, usdOf(pre.sqrtPriceX96, ms0), ms0)) : null,
      peakPct: Math.round(peak * 1e4) / 100,
      hoursAbove: Object.fromEntries(HOUR_THRESHOLDS.map((t) => [t, Math.round((above[t] / 3600) * 10) / 10])),
      lastPrice: last ? { block: last.block, sqrtPriceX96: last.sqrtPriceX96 } : null,
      stockIs0: ms0,
      buys,
    });
  }
  return rows.sort((a, b) => b.peakPct - a.peakPct);
}
