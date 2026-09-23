// Pure post-processing of an EpochSim result into the backtest's headline table.
import type { Params } from "../../keeper/src/engine.js";

export interface EventCfg {
  ticker: string;
  title: string;
  windowStart: string;
  p0: string;
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
  return {
    summary: {
      ticker: ev.ticker,
      p0Usd: sim.arm.p0Usd,
      bandUsd: sim.arm.bandUsd,
      maxPoolUsd: sim.stats.maxUsd,
      settlePoolUsd: sim.settlement.poolUsd,
      headline: `${headline.vsHodlPctExFees >= 0 ? "+" : ""}${headline.vsHodlPctExFees}% STOCK vs HODL (lockOnFill, ex-fees)`,
      rows,
    },
    sim,
    caveats: [
      sim.caveat,
      `P0: ${ev.p0Source}.`,
      `Buyback price: ${ev.freshSource}.`,
      "LP-fee figures assume the vault's liquidity did not change the price path; use the ex-fee columns as the robust number.",
    ],
  };
}
