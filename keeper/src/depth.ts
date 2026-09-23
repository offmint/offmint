// Quote-agnostic pool depth helpers (tested in backtest/test/screen.test.ts and keeper/test/detector.test.ts).
import { usdToSqrtPriceX96, amountsForLiquidity } from "./rangeMath.js";

const Q96 = 1n << 96n;
const D8 = { feed: 8, stock: 18, usd: 6 };

/** STOCK (18 dec) held by liquidity L between the current price and +10% (in the pool's own price terms). */
export function stockDepthWithin10(L: bigint, sqrtP: bigint, stockIs0: boolean): number {
  if (L === 0n || sqrtP === 0n) return 0;
  // sqrt(1.1) ~= 1.0488088; k = 1 - 1/sqrt(1.1)
  const K = 46_537n; // 1e6 * (1 - 1/1.0488088)
  const raw = stockIs0 ? (L * Q96 * K) / sqrtP / 1_000_000n : (L * sqrtP * K) / Q96 / 1_000_000n;
  return Number(raw) / 1e18;
}

/** % price impact of buying `usd` worth of STOCK with USDG in a single-tick approximation (active liquidity L). */
export function impactPct(L: bigint, sqrtP: bigint, stockIs0: boolean, usd: number): number {
  if (L === 0n) return Infinity;
  const dUsdg = BigInt(Math.round(usd * 1e6));
  if (stockIs0) {
    // USDG is token1: sqrt rises by dy/L; USD price ~ sqrt^2
    const s1 = sqrtP + (dUsdg * Q96) / L;
    return (Number((s1 * 1_000_000n) / sqrtP) ** 2 / 1e12 - 1) * 100;
  }
  // USDG is token0: 1/sqrt rises by dx/L -> sqrt falls; USD price ~ 1/sqrt^2
  const inv0 = (Q96 * Q96) / sqrtP;
  const inv1 = inv0 + (dUsdg * Q96) / L;
  return (Number((inv1 * 1_000_000n) / inv0) ** 2 / 1e12 - 1) * 100;
}

/** USDG (in USD) needed to push a STOCK/USDG pool from p to p*1.1 with active liquidity L (single-tick approximation). */
export function usdToPush10(L: bigint, p: number, stockIs0: boolean): number {
  const a = usdToSqrtPriceX96(BigInt(Math.round(p * 1e8)), D8, stockIs0);
  const b = usdToSqrtPriceX96(BigInt(Math.round(p * 1.1 * 1e8)), D8, stockIs0);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const raw = stockIs0 ? (L * (hi - lo)) >> 96n : ((L << 96n) * (hi - lo)) / lo / hi;
  return Number(raw) / 1e6;
}

/**
 * Pool TVL estimate in USD: both tokens held by the CURRENT active liquidity L between p/2 and 2p, valued at p.
 * (SPEC §3.7 asks for an average TVL; without archive state this is the current snapshot, labelled as such.)
 */
export function tvlUsdEstimate(L: bigint, p: number, stockIs0: boolean): number {
  if (L === 0n || !(p > 0)) return 0;
  const s = usdToSqrtPriceX96(BigInt(Math.round(p * 1e8)), D8, stockIs0);
  const a = usdToSqrtPriceX96(BigInt(Math.round((p / 2) * 1e8)), D8, stockIs0);
  const b = usdToSqrtPriceX96(BigInt(Math.round(p * 2 * 1e8)), D8, stockIs0);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  const { amount0, amount1 } = amountsForLiquidity(L, s, lo, hi);
  const [stockRaw, usdgRaw] = stockIs0 ? [amount0, amount1] : [amount1, amount0];
  return (Number(stockRaw) / 1e18) * p + Number(usdgRaw) / 1e6;
}
