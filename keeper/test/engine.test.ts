// EpochSim on synthetic Swap streams: validates the range-order model and the three variants without a network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EpochSim, DEFAULT_PARAMS, type TickerCfg } from "../src/engine.js";
import { usdToSqrtPriceX96, usdToTick, type Decimals } from "../src/rangeMath.js";
import type { SwapLog } from "../src/chain.js";

const SAT = 1790380800;
const MON = SAT + 2 * 86400;
const d: Decimals = { feed: 8, stock: 18, usd: 6 };
const usd = (x: number) => BigInt(Math.round(x * 1e8));

function run(s0: boolean, path: [number, number][], opts: { fresh: number; settlePool?: number; liq?: bigint } = { fresh: 30.6 }) {
  const cfg: TickerCfg = {
    ticker: "T", stock: "0x1", feed: "0x2", feedDecimals: 8, stockIsCurrency0: s0, poolId: "0x3", fee: 3000, tickSpacing: 60,
  };
  const sim = new EpochSim(cfg, DEFAULT_PARAMS, SAT, MON);
  const p0 = usd(30);
  sim.doArm({ time: SAT + 300, block: 1n, p0, p0Source: "chainlink", feedUpdatedAt: SAT - 14400, sqrtPriceX96: usdToSqrtPriceX96(p0, d, s0), tick: usdToTick(p0, d, s0) });
  let block = 2n;
  for (const [t, px] of path) {
    const sq = usdToSqrtPriceX96(usd(px), d, s0);
    const log: SwapLog = {
      poolId: "0x3", block: block++, logIndex: 0, ts: t, sqrtPriceX96: sq, tick: usdToTick(usd(px), d, s0), fee: 3000,
      // a big swap with deep pool liquidity -> fee cap never binds
      amount0: -(10n ** 30n), amount1: -(10n ** 30n), liquidity: opts.liq ?? 10n ** 20n,
    };
    sim.ingest(log);
  }
  const settlePx = opts.settlePool ?? opts.fresh;
  sim.doSettle({ time: MON + 3600, block, fresh: usd(opts.fresh), freshSource: "chainlink", freshUpdatedAt: MON, sqrtPriceX96: usdToSqrtPriceX96(usd(settlePx), d, s0) });
  return sim;
}

const spikeThenCollapse: [number, number][] = [
  [SAT + 3600, 31],
  [MON - 3 * 3600, 40],
  [MON - 2 * 3600, 55], // above band top (30 * 1.6 = 48)
  [MON - 60 * 60, 50],
  [MON + 600, 31], // Monday mint arbitrage
];

for (const s0 of [true, false]) {
  const o = s0 ? "S0" : "S1";

  test(`${o}: band sits at P0*1.1 .. P0*1.6`, () => {
    const sim = run(s0, []);
    const [lo, hi] = sim.arm!.bandUsd;
    assert.ok(lo >= 33 && lo < 33.3, `lo ${lo}`);
    assert.ok(hi > 47.5 && hi <= 48, `hi ${hi}`);
  });

  test(`${o}: no fills -> every variant returns the deployed stock`, () => {
    const sim = run(s0, [[SAT + 3600, 30.5], [SAT + 7200, 31.5]], { fresh: 30 });
    for (const v of ["spec", "lockOnFill", "lockPreOpen"]) {
      for (const r of sim.settlement.results[v]) {
        assert.ok(Math.abs(r.stockBack - r.deployed) < 1e-9, `${v} ${r.stockBack}`);
        assert.equal(r.usdgReceived, 0);
        assert.equal(r.vsHodlPct, 0);
      }
    }
  });

  test(`${o}: spike then collapse -> spec ~flat ex-fees, locks capture the premium`, () => {
    const sim = run(s0, spikeThenCollapse, { fresh: 30.6 });
    const q = (v: string) => sim.settlement.results[v].at(-1);
    assert.equal(q("spec").vsHodlPctExFees, 0, "range order un-sold on the way down");
    assert.ok(q("lockOnFill").vsHodlPctExFees > 25, `lockOnFill ${q("lockOnFill").vsHodlPctExFees}`);
    assert.ok(q("lockOnFill").avgSellUsd > 39 && q("lockOnFill").avgSellUsd < 41, `avg ${q("lockOnFill").avgSellUsd}`);
    assert.ok(q("lockOnFill").lockedAt, "locked when the band was cleared");
    // lockPreOpen pulled at 23:45 while the pool traded at 50 (above band): fully sold too
    assert.equal(q("lockPreOpen").vsHodlPctExFees, q("lockOnFill").vsHodlPctExFees);
  });

  test(`${o}: gap-up above the buyback cap -> PENDING_BUYBACK, USDG left`, () => {
    const sim = run(s0, spikeThenCollapse.slice(0, 3), { fresh: 45, settlePool: 50 });
    const r = sim.settlement.results.lockOnFill.at(-1);
    assert.equal(sim.settlement.buybackPossible, false);
    assert.equal(r.state, "PENDING_BUYBACK");
    assert.ok(r.usdgLeft > 0);
    assert.equal(r.stockBought, 0);
  });

  test(`${o}: fee estimate capped by share of active liquidity`, () => {
    const deep = run(s0, spikeThenCollapse, { fresh: 30.6, liq: 10n ** 24n });
    const thin = run(s0, spikeThenCollapse, { fresh: 30.6, liq: 0n });
    const f = (s: EpochSim) => s.settlement.results.spec.at(-1).lpFeesStockEq;
    assert.ok(f(deep) >= 0 && f(thin) >= f(deep));
  });

  test(`${o}: perf fee only on gains, 10%`, () => {
    const sim = run(s0, spikeThenCollapse, { fresh: 30.6 });
    const r = sim.settlement.results.lockOnFill.at(-1);
    const gross = r.stockBack + r.stockBought - r.deployed;
    assert.ok(Math.abs(r.feeStock - gross * 0.1) < 1e-4);
  });
}

test("output JSON carries the caveat and downsampled series", () => {
  const path: [number, number][] = Array.from({ length: 5000 }, (_, i) => [SAT + 3600 + i * 30, 30 + 5 * Math.sin(i / 50)]);
  const j = run(true, path, { fresh: 30 }).toJSON();
  assert.ok(j.timeline.length <= 1500 + 2);
  assert.match(j.caveat, /Hypothetical/);
  assert.equal(j.status, "settled");
});
