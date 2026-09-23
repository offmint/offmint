// Hypothetical-epoch simulator shared by paper mode (live) and replay (historical weekends).
// Models the vault's one-sided range position exactly (concentrated-liquidity amounts), priced off real pool Swap logs.
// Assumes our position is small enough not to move the pool price (stated as a caveat in every output).
import { getSqrtPriceAtTick } from "./tickMath.js";
import { sellRange, sqrtPriceX96ToUsd, liquidityForStock, amountsForLiquidity, type Decimals } from "./rangeMath.js";
import type { SwapLog } from "./chain.js";
import { iso } from "./clock.js";

export interface TickerCfg {
  ticker: string;
  stock: `0x${string}`;
  feed: `0x${string}` | null;
  feedDecimals: number;
  stockIsCurrency0: boolean;
  poolId: `0x${string}`;
  fee: number;
  tickSpacing: number;
}

export interface Params {
  premiumBps: number;
  widthBps: number;
  armDelay: number;
  minFrozen: number;
  maxPreCloseAge: number;
  settleDelay: number;
  maxFreshAge: number;
  emergencyDelay: number;
  buybackSlippageBps: number;
  perfFeeBps: number;
  lockLead: number; // variant C: seconds before windowEnd at which the position is pulled
  quantities: number[]; // hypothetical STOCK deployed, whole tokens
}

/** SPEC defaults (§4, §6.5). */
export const DEFAULT_PARAMS: Params = {
  premiumBps: 1000,
  widthBps: 5000,
  armDelay: 300,
  minFrozen: 900,
  maxPreCloseAge: 6 * 3600,
  settleDelay: 3600,
  maxFreshAge: 3600,
  emergencyDelay: 96 * 3600,
  buybackSlippageBps: 100,
  perfFeeBps: 1000,
  lockLead: 15 * 60,
  quantities: [10, 50, 100],
};

/**
 * Variants (all start identical at arm):
 *  - spec:        hold the range until settle (SPEC §6.6 as written).
 *  - lockOnFill:  pull the position the first time price exits the range on the sell side (100% USDG).
 *  - lockPreOpen: pull the position `lockLead` seconds before windowEnd, whatever it holds.
 * A range order un-sells when price falls back through it, so these can differ a lot.
 */
export const VARIANTS = ["spec", "lockOnFill", "lockPreOpen"] as const;
type Variant = (typeof VARIANTS)[number];

interface Pos {
  L: bigint;
  amount0: bigint;
  amount1: bigint;
  fee0: bigint;
  fee1: bigint;
  lockedAt: number | null;
  lockedUsd: number | null;
}

const STOCK_DEC = 18;
const USD_DEC = 6;

export class EpochSim {
  readonly d: Decimals;
  status: "waiting" | "armed" | "skipped" | "settled" = "waiting";
  arm?: {
    time: number;
    block: string;
    p0: string;
    p0Usd: number;
    p0Source: "chainlink" | "pool";
    feedUpdatedAt: number | null;
    poolUsdAtArm: number;
    tick: number;
    tickLower: number;
    tickUpper: number;
    bandUsd: [number, number];
  };
  checks: Record<string, boolean | string | number | null> = {};
  skipReason: string | null = null;
  timeline: { t: number; usd: number }[] = [];
  fills: { t: number; usd: number; soldPct: number }[] = [];
  maxUsd = 0;
  minUsd = Number.POSITIVE_INFINITY;
  firstInBandAt: number | null = null;
  lastBlock = 0n;
  private s = 0n;
  private sa = 0n;
  private sb = 0n;
  private pos: Record<Variant, Pos[]> = { spec: [], lockOnFill: [], lockPreOpen: [] };
  settlement: any = null;

  constructor(
    readonly cfg: TickerCfg,
    readonly params: Params,
    readonly windowStart: number,
    readonly windowEnd: number,
  ) {
    this.d = { feed: cfg.feedDecimals, stock: STOCK_DEC, usd: USD_DEC };
  }

  usd(sqrtPriceX96: bigint): number {
    return Number(sqrtPriceX96ToUsd(sqrtPriceX96, this.d, this.cfg.stockIsCurrency0)) / 10 ** this.d.feed;
  }

  skip(reason: string) {
    this.status = "skipped";
    this.skipReason = reason;
  }

  doArm(a: { time: number; block: bigint; p0: bigint; p0Source: "chainlink" | "pool"; feedUpdatedAt: number | null; sqrtPriceX96: bigint; tick: number }) {
    const { cfg, params } = this;
    let r: { tickLower: number; tickUpper: number };
    try {
      r = sellRange(a.p0, BigInt(params.premiumBps), BigInt(params.widthBps), a.tick, cfg.tickSpacing, this.d, cfg.stockIsCurrency0);
    } catch {
      return this.skip("RangeInvalid: pool already above the band at arm");
    }
    this.sa = getSqrtPriceAtTick(r.tickLower);
    this.sb = getSqrtPriceAtTick(r.tickUpper);
    this.s = a.sqrtPriceX96;
    this.lastBlock = a.block;
    const edgeUsd = [this.usd(this.sa), this.usd(this.sb)].sort((x, y) => x - y) as [number, number];
    this.arm = {
      time: a.time,
      block: a.block.toString(),
      p0: a.p0.toString(),
      p0Usd: Number(a.p0) / 10 ** this.d.feed,
      p0Source: a.p0Source,
      feedUpdatedAt: a.feedUpdatedAt,
      poolUsdAtArm: this.usd(a.sqrtPriceX96),
      tick: a.tick,
      ...r,
      bandUsd: edgeUsd,
    };
    for (const v of VARIANTS) {
      this.pos[v] = params.quantities.map((q) => {
        const L = liquidityForStock(BigInt(q) * 10n ** 18n, this.sa, this.sb, cfg.stockIsCurrency0);
        const { amount0, amount1 } = amountsForLiquidity(L, this.s, this.sa, this.sb);
        return { L, amount0, amount1, fee0: 0n, fee1: 0n, lockedAt: null, lockedUsd: null };
      });
    }
    this.status = "armed";
    this.point(a.time, a.sqrtPriceX96);
  }

  private point(t: number, s: bigint) {
    const u = this.usd(s);
    this.timeline.push({ t, usd: u });
    this.maxUsd = Math.max(this.maxUsd, u);
    this.minUsd = Math.min(this.minUsd, u);
    if (this.firstInBandAt === null && this.arm && u >= this.arm.bandUsd[0]) this.firstInBandAt = t;
  }

  private stockOf(p: Pos) {
    return this.cfg.stockIsCurrency0 ? p.amount0 : p.amount1;
  }

  /** Pull the position for one variant (stops it from trading further). */
  lock(v: Variant, t: number) {
    for (const p of this.pos[v]) {
      if (p.lockedAt === null) {
        p.lockedAt = t;
        p.lockedUsd = this.usd(this.s);
      }
    }
  }

  ingest(sw: SwapLog) {
    if (this.status !== "armed") return;
    if (sw.ts >= this.windowEnd - this.params.lockLead) this.lock("lockPreOpen", this.windowEnd - this.params.lockLead);
    const prev = this.s;
    const next = sw.sqrtPriceX96;
    const f = BigInt(sw.fee);
    for (const v of VARIANTS) {
      for (const p of this.pos[v]) {
        if (p.lockedAt !== null) continue;
        const n = amountsForLiquidity(p.L, next, this.sa, this.sb);
        // Input token pays the fee: price up => token1 in, price down => token0 in.
        // Our fee = min(fee on what our liquidity absorbed, swap's total fee x our share of active liquidity).
        // The cap matters when pool liquidity inside the band is thin and the no-impact assumption breaks.
        const share = (x: bigint) => (x * p.L) / (p.L + sw.liquidity);
        if (next > prev && n.amount1 > p.amount1) {
          const mine = ((n.amount1 - p.amount1) * f) / (1_000_000n - f);
          const cap = share(((sw.amount1 < 0n ? -sw.amount1 : 0n) * f) / 1_000_000n);
          p.fee1 += mine < cap ? mine : cap;
        }
        if (next < prev && n.amount0 > p.amount0) {
          const mine = ((n.amount0 - p.amount0) * f) / (1_000_000n - f);
          const cap = share(((sw.amount0 < 0n ? -sw.amount0 : 0n) * f) / 1_000_000n);
          p.fee0 += mine < cap ? mine : cap;
        }
        p.amount0 = n.amount0;
        p.amount1 = n.amount1;
        const fullySold = this.cfg.stockIsCurrency0 ? next >= this.sb : next <= this.sa;
        if (v === "lockOnFill" && fullySold) {
          p.lockedAt = sw.ts;
          p.lockedUsd = this.usd(next);
        }
      }
    }
    this.s = next;
    this.lastBlock = sw.block;
    this.point(sw.ts, next);
    const ref = this.pos.spec[this.pos.spec.length - 1];
    if (ref && prev !== next) {
      const q = BigInt(this.params.quantities[this.params.quantities.length - 1]) * 10n ** 18n;
      const soldPct = Number(((q - this.stockOf(ref)) * 10_000n) / q) / 100;
      const lastPct = this.fills.at(-1)?.soldPct ?? 0;
      if (Math.abs(soldPct - lastPct) >= 0.01) this.fills.push({ t: sw.ts, usd: this.usd(next), soldPct });
    }
  }

  /** Settle every variant at the pool price `sqrtPriceX96` with fresh oracle price `fresh` (feed decimals). */
  doSettle(a: { time: number; block: bigint; fresh: bigint; freshSource: "chainlink" | "pool"; freshUpdatedAt: number | null; sqrtPriceX96: bigint }) {
    if (this.status !== "armed") return;
    this.lock("lockPreOpen", this.windowEnd - this.params.lockLead);
    const { params, cfg } = this;
    const freshUsd = Number(a.fresh) / 10 ** this.d.feed;
    const capUsd = (freshUsd * (10_000 + params.buybackSlippageBps)) / 10_000;
    const poolUsd = this.usd(a.sqrtPriceX96);
    const feeRate = cfg.fee / 1_000_000;
    const buyPx = poolUsd / (1 - feeRate); // effective price incl. LP fee, ignoring our own impact
    const canBuy = poolUsd <= capUsd;
    const results: Record<string, any[]> = {};
    for (const v of VARIANTS) {
      results[v] = this.pos[v].map((p, i) => {
        const q = params.quantities[i];
        const [stockRaw, usdRaw] = cfg.stockIsCurrency0 ? [p.amount0 + p.fee0, p.amount1 + p.fee1] : [p.amount1 + p.fee1, p.amount0 + p.fee0];
        const stockBack = Number(stockRaw) / 1e18;
        const usdg = Number(usdRaw) / 1e6;
        const stockBought = canBuy ? usdg / buyPx : 0;
        const usdgLeft = canBuy ? 0 : usdg;
        const pnl = stockBack + stockBought - q;
        const feeStock = pnl > 0 && canBuy ? (pnl * params.perfFeeBps) / 10_000 : 0;
        const net = stockBack + stockBought - feeStock;
        // same epoch with LP fees stripped out (fees are the least robust part of the estimate)
        const [s0x, u0x] = cfg.stockIsCurrency0 ? [p.amount0, p.amount1] : [p.amount1, p.amount0];
        const exStock = Number(s0x) / 1e18 + (canBuy ? Number(u0x) / 1e6 / buyPx : 0);
        const exPnl = exStock - q;
        const exNet = exStock - (exPnl > 0 && canBuy ? (exPnl * params.perfFeeBps) / 10_000 : 0);
        return {
          deployed: q,
          stockBack: round(stockBack),
          usdgReceived: round(usdg, 2),
          avgSellUsd: q - stockBack > 1e-9 ? round(usdg / (q - stockBack), 4) : null,
          stockBought: round(stockBought),
          usdgLeft: round(usdgLeft, 2),
          feeStock: round(feeStock),
          netStock: round(net),
          vsHodlPct: round(((net - q) / q) * 100, 4),
          lpFeesStockEq: round(net - exNet),
          vsHodlPctExFees: round(((exNet - q) / q) * 100, 4),
          lockedAt: p.lockedAt ? iso(p.lockedAt) : null,
          lockedUsd: p.lockedUsd ? round(p.lockedUsd, 4) : null,
          state: canBuy ? "OPEN" : "PENDING_BUYBACK",
        };
      });
    }
    this.settlement = {
      time: a.time,
      timeIso: iso(a.time),
      block: a.block.toString(),
      freshUsd,
      freshSource: a.freshSource,
      freshUpdatedAt: a.freshUpdatedAt,
      poolUsd: round(poolUsd, 4),
      capUsd: round(capUsd, 4),
      buybackPossible: canBuy,
      results,
    };
    this.status = "settled";
  }

  toJSON() {
    return {
      ticker: this.cfg.ticker,
      stock: this.cfg.stock,
      feed: this.cfg.feed,
      poolId: this.cfg.poolId,
      poolFee: this.cfg.fee,
      tickSpacing: this.cfg.tickSpacing,
      stockIsCurrency0: this.cfg.stockIsCurrency0,
      window: { start: this.windowStart, end: this.windowEnd, startIso: iso(this.windowStart), endIso: iso(this.windowEnd) },
      params: this.params,
      status: this.status,
      skipReason: this.skipReason,
      checks: this.checks,
      arm: this.arm ?? null,
      stats: {
        swaps: Math.max(0, this.timeline.length - 1),
        maxUsd: this.timeline.length ? round(this.maxUsd, 4) : null,
        minUsd: this.timeline.length ? round(this.minUsd, 4) : null,
        maxPremiumPct: this.arm && this.timeline.length ? round((this.maxUsd / this.arm.p0Usd - 1) * 100, 2) : null,
        firstInBandAt: this.firstInBandAt ? iso(this.firstInBandAt) : null,
        lastBlock: this.lastBlock.toString(),
      },
      timeline: downsample(this.timeline, 1500),
      fills: downsample(this.fills, 500),
      settlement: this.settlement,
      caveat: "Hypothetical: assumes the vault's position does not move the pool price. A live vault would dampen spikes; real fills would differ.",
      generatedAt: iso(Math.floor(Date.now() / 1000)),
    };
  }
}

const round = (x: number, dp = 6) => Math.round(x * 10 ** dp) / 10 ** dp + 0; // + 0 normalises -0

/** Keeps first/last and per-bucket min/max so spikes survive downsampling. */
function downsample<T extends { t: number; usd: number }>(xs: T[], max: number): T[] {
  if (xs.length <= max) return xs;
  const bucket = Math.ceil(xs.length / (max / 2));
  const out: T[] = [];
  for (let i = 0; i < xs.length; i += bucket) {
    const b = xs.slice(i, i + bucket);
    const lo = b.reduce((m, x) => (x.usd < m.usd ? x : m));
    const hi = b.reduce((m, x) => (x.usd > m.usd ? x : m));
    out.push(...(lo.t <= hi.t ? [lo, hi] : [hi, lo]));
  }
  out[out.length - 1] = xs[xs.length - 1];
  return out.filter((x, i) => i === 0 || x !== out[i - 1]);
}
