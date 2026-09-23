// Pure post-processing of an EpochSim result into the backtest's headline table.
import type { Params } from "../../keeper/src/engine.js";

/** MetaVault round-trip costs (SPEC §10 friction, §6.5.3 txFeeBps). */
export interface Friction {
  poolFeeBps: number; // per swap leg (buy-in, unwind): the pool's fee tier
  slippageBps: number; // per swap leg: price impact estimate
  txFeeBps: number; // MetaVault fee on deposit AND on withdraw
}
export const DEFAULT_FRICTION = (poolFeePips: number): Friction => ({ poolFeeBps: poolFeePips / 100, slippageBps: 30, txFeeBps: 50 });

/**
 * USDG-denominated MetaVault result for one epoch: shares gained by the engine, times the stock's own move from buy-in
 * to unwind, minus round-trip friction (2 pool-fee legs, 2 slippage legs, txFee on deposit + withdraw).
 */
export function metaVaultNet(sharesGainPct: number, buyInUsd: number, unwindUsd: number, f: Friction) {
  const frictionPct = (2 * f.poolFeeBps + 2 * f.slippageBps + 2 * f.txFeeBps) / 100;
  const priceMovePct = (unwindUsd / buyInUsd - 1) * 100;
  const grossUsdPct = ((1 + sharesGainPct / 100) * (unwindUsd / buyInUsd) - 1) * 100;
  const netUsdPct = ((1 + grossUsdPct / 100) * (1 - frictionPct / 100) - 1) * 100;
  const r = (x: number) => Math.round(x * 100) / 100;
  return { sharesGainPct: r(sharesGainPct), priceMovePct: r(priceMovePct), grossUsdPct: r(grossUsdPct), frictionPct: r(frictionPct), netUsdPct: r(netUsdPct) };
}

export interface EventCfg {
  ticker: string;
  title: string;
  windowStart: string;
  p0: string | null;
  p0Source: string;
  freshSource: string;
  params?: Partial<Params>;
}

export interface Row {
  variant: string;
  deployed: number;
  avgSellUsd: number | null;
  usdgReceived: number;
  stockBought: number;
  netStockDelta: number;
  vsHodlPct: number;
  vsHodlPctExFees: number;
  state: string;
}

export function summarize(sim: any, ev: EventCfg) {
  if (!sim.settlement) throw new Error("epoch not settled");
  const rows: Row[] = [];
  for (const [variant, results] of Object.entries<any[]>(sim.settlement.results)) {
    for (const r of results) {
      rows.push({
        variant,
        deployed: r.deployed,
        avgSellUsd: r.avgSellUsd,
        usdgReceived: r.usdgReceived,
        stockBought: r.stockBought,
        netStockDelta: Math.round((r.netStock - r.deployed) * 1e6) / 1e6,
        vsHodlPct: r.vsHodlPct,
        vsHodlPctExFees: r.vsHodlPctExFees,
        state: r.state,
      });
    }
  }
  const headline = rows.filter((r) => r.variant === "lockOnFill").at(-1)!;
  // MetaVault view (SPEC §10): buy-in ~ Friday close (P0), unwind at the Monday settle price; gross vs net
  const friction = DEFAULT_FRICTION(sim.poolFee ?? 3000);
  const metaVault = {
    assumptions: { buyInUsd: sim.arm.p0Usd, unwindUsd: sim.settlement.poolUsd, ...friction, note: "buy-in approximated at the Friday close; real Thursday buy-in price differs" },
    exFees: metaVaultNet(headline.vsHodlPctExFees, sim.arm.p0Usd, sim.settlement.poolUsd, friction),
  };
  return {
    summary: {
      ticker: ev.ticker,
      p0Usd: sim.arm.p0Usd,
      bandUsd: sim.arm.bandUsd,
      maxPoolUsd: sim.stats.maxUsd,
      settlePoolUsd: sim.settlement.poolUsd,
      headline: `${headline.vsHodlPctExFees >= 0 ? "+" : ""}${headline.vsHodlPctExFees}% STOCK vs HODL (lockOnFill, ex-fees)`,
      metaVault,
      rows,
    },
    sim,
    caveats: [
      sim.caveat,
      `P0: ${ev.p0Source}.`,
      `Buyback price: ${ev.freshSource}.`,
      "LP-fee figures assume the vault's liquidity did not change the price path; use the ex-fee columns as the robust number.",
      "MetaVault net = shares gained x the stock's own buy-in-to-unwind move, minus 2 pool-fee legs, 2 slippage legs and txFeeBps on deposit + withdraw. A marginal squeeze can turn negative after costs.",
    ],
  };
}
