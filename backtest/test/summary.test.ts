import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, type EventCfg } from "../src/summary.js";

const ev: EventCfg = { ticker: "HIMS", title: "t", windowStart: "2026-08-29T00:00:00Z", p0: "28.84", p0Source: "x", freshSource: "y" };
const r = (deployed: number, netStock: number, exFees: number) => ({
  deployed, netStock, vsHodlPct: ((netStock - deployed) / deployed) * 100, vsHodlPctExFees: exFees,
  avgSellUsd: 40, usdgReceived: 100, stockBought: 3, state: "OPEN",
});
const sim = {
  caveat: "Hypothetical",
  arm: { p0Usd: 28.84, bandUsd: [31.7, 46.1] },
  stats: { maxUsd: 70 },
  settlement: { poolUsd: 32.5, results: { spec: [r(100, 100, 0)], lockOnFill: [r(10, 11.8, 18), r(100, 118, 18)] } },
};

test("summary rows cover every variant x quantity; headline uses lockOnFill ex-fees at the largest size", () => {
  const s = summarize(sim, ev);
  assert.equal(s.summary.rows.length, 3);
  assert.equal(s.summary.headline, "+18% STOCK vs HODL (lockOnFill, ex-fees)");
  assert.equal(s.summary.rows.find((x) => x.variant === "lockOnFill" && x.deployed === 100)!.netStockDelta, 18);
  assert.ok(s.caveats.some((c) => c.includes("P0: x")));
});

test("unsettled epoch is rejected", () => {
  assert.throws(() => summarize({ ...sim, settlement: null }, ev), /not settled/);
});

test("MetaVault net: friction and the stock's own move are both counted", async () => {
  const { metaVaultNet } = await import("../src/summary.js");
  const f = { poolFeeBps: 30, slippageBps: 30, txFeeBps: 50 };
  const flat = metaVaultNet(0, 10, 10, f); // no squeeze, no price move: pure cost
  assert.equal(flat.frictionPct, 2.2);
  assert.equal(flat.netUsdPct, -2.2);
  const marginal = metaVaultNet(1.5, 10, 10, f); // +1.5% shares is NOT enough to cover a 2.2% round trip
  assert.ok(marginal.grossUsdPct > 0 && marginal.netUsdPct < 0);
  const down = metaVaultNet(18.57, 30, 27, f); // big squeeze but the stock fell 10% by Monday
  assert.equal(down.priceMovePct, -10);
  assert.ok(down.netUsdPct < down.sharesGainPct);
});
