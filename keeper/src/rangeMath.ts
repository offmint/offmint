// Bigint port of contracts/src/libraries/RangeMath.sol. Must stay in lock-step with the Solidity version.
import { Q192, getSqrtPriceAtTick, getTickAtSqrtPrice, MIN_TICK, MAX_TICK, MIN_SQRT_PRICE, MAX_SQRT_PRICE } from "./tickMath.js";

export const BPS = 10_000n;

export interface Decimals {
  feed: number; // Chainlink decimals, read from the feed
  stock: number; // 18
  usd: number; // USDG, 6
}

const pow10 = (n: number) => 10n ** BigInt(n);
const divUp = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function sqrtBig(x: bigint, roundUp = false): bigint {
  if (x < 0n) throw new Error("sqrt of negative");
  if (x < 2n) return x;
  let z = x;
  let y = (x >> 1n) + 1n;
  while (y < z) {
    z = y;
    y = (x / y + y) >> 1n;
  }
  return roundUp && z * z < x ? z + 1n : z;
}

/** USD feed answer -> sqrtPriceX96 (SPEC §5.1). */
export function usdToSqrtPriceX96(answer: bigint, d: Decimals, stockIs0: boolean, roundUp = false): bigint {
  if (answer <= 0n) throw new Error("price zero");
  const scaleStock = pow10(d.feed + d.stock);
  const usdRaw = answer * pow10(d.usd);
  const [num, den] = stockIs0 ? [usdRaw * Q192, scaleStock] : [scaleStock * Q192, usdRaw];
  const x = roundUp ? divUp(num, den) : num / den;
  const s = sqrtBig(x, roundUp);
  if (s < MIN_SQRT_PRICE || s >= MAX_SQRT_PRICE) throw new Error("price out of range");
  return s;
}

/** sqrtPriceX96 -> USD answer in feed decimals (rounded down). */
export function sqrtPriceX96ToUsd(s: bigint, d: Decimals, stockIs0: boolean): bigint {
  const scale = pow10(d.feed + d.stock - d.usd);
  return stockIs0 ? (s * s * scale) >> 192n : (scale << 192n) / (s * s);
}

export const usdToTick = (answer: bigint, d: Decimals, stockIs0: boolean) =>
  getTickAtSqrtPrice(usdToSqrtPriceX96(answer, d, stockIs0, false));
export const tickToUsd = (tick: number, d: Decimals, stockIs0: boolean) =>
  sqrtPriceX96ToUsd(getSqrtPriceAtTick(tick), d, stockIs0);

export function floorToSpacing(t: number, s: number): number {
  return Math.floor(t / s) * s;
}
export function ceilToSpacing(t: number, s: number): number {
  return Math.ceil(t / s) * s;
}

/** One-sided sell range, SPEC §5.2. Throws "RangeInvalid" like the contract. */
export function sellRange(
  p0: bigint,
  premiumBps: bigint,
  widthBps: bigint,
  curTick: number,
  spacing: number,
  d: Decimals,
  stockIs0: boolean,
): { tickLower: number; tickUpper: number } {
  const lUsd = divUp(p0 * (BPS + premiumBps), BPS);
  const uUsd = (p0 * (BPS + premiumBps + widthBps)) / BPS;
  let tickLower: number;
  let tickUpper: number;
  if (stockIs0) {
    const sL = usdToSqrtPriceX96(lUsd, d, true, true);
    let tL = getTickAtSqrtPrice(sL);
    if (getSqrtPriceAtTick(tL) < sL) tL += 1;
    tickLower = ceilToSpacing(tL, spacing);
    tickUpper = floorToSpacing(usdToTick(uUsd, d, true), spacing);
    if (tickLower <= curTick) tickLower = ceilToSpacing(curTick + 1, spacing);
  } else {
    tickUpper = floorToSpacing(usdToTick(lUsd, d, false), spacing);
    tickLower = ceilToSpacing(getTickAtSqrtPrice(usdToSqrtPriceX96(uUsd, d, false, true)), spacing);
    if (tickUpper > curTick) tickUpper = floorToSpacing(curTick, spacing);
  }
  const minUsable = Math.ceil(MIN_TICK / spacing) * spacing;
  const maxUsable = Math.floor(MAX_TICK / spacing) * spacing;
  if (tickUpper <= tickLower || tickLower < minUsable || tickUpper > maxUsable) throw new Error("RangeInvalid");
  return { tickLower, tickUpper };
}

/** Buyback cap sqrtPrice: fresh * (1 + slippage), rounded so the cap never exceeds the USD limit (SPEC §5.3). */
export function buybackSqrtCap(fresh: bigint, slippageBps: bigint, d: Decimals, stockIs0: boolean): bigint {
  return usdToSqrtPriceX96((fresh * (BPS + slippageBps)) / BPS, d, stockIs0, !stockIs0);
}

// ---------------------------------------------------------------- concentrated-liquidity amounts

/** Liquidity for a single-sided STOCK position of `amountStock` raw units in [sa, sb]. */
export function liquidityForStock(amountStock: bigint, sa: bigint, sb: bigint, stockIs0: boolean): bigint {
  // amount0 = L * (sb - sa) * Q96 / (sa * sb);  amount1 = L * (sb - sa) / Q96
  return stockIs0 ? (amountStock * sa * sb) / ((sb - sa) << 96n) : (amountStock << 96n) / (sb - sa);
}

/** Token amounts held by liquidity L in [sa, sb] at price s. Rounded down (what a burn would return, ex-fees). */
export function amountsForLiquidity(L: bigint, s: bigint, sa: bigint, sb: bigint): { amount0: bigint; amount1: bigint } {
  if (s <= sa) return { amount0: (((L << 96n) * (sb - sa)) / sb) / sa, amount1: 0n };
  if (s >= sb) return { amount0: 0n, amount1: (L * (sb - sa)) >> 96n };
  return { amount0: (((L << 96n) * (sb - s)) / sb) / s, amount1: (L * (s - sa)) >> 96n };
}
