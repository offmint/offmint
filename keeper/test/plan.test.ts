import { test } from "node:test";
import assert from "node:assert/strict";
import { armPlan, settlePlan } from "../src/plan.js";
import { EpochSim, DEFAULT_PARAMS, type TickerCfg } from "../src/engine.js";
import type { Round } from "../src/chain.js";

const SAT = 1790380800;
const MON = SAT + 2 * 86400;
const cfg: TickerCfg = {
  ticker: "TSLA", stock: "0x1", feed: "0x2", feedDecimals: 8, stockIsCurrency0: true,
  poolId: "0x3", fee: 3000, tickSpacing: 60,
};
const sim = () => new EpochSim(cfg, DEFAULT_PARAMS, SAT, MON);
const r = (updatedAt: number, answer = 30_00000000n): Round => ({ roundId: BigInt(updatedAt), answer, updatedAt });

test("arm: Friday 20:00 close -> arm at window start + armDelay", () => {
  const s = sim();
  const p = armPlan(s, [r(SAT - 4 * 3600)]);
  assert.equal(p.time, SAT + 300);
  assert.equal(p.reason, undefined);
  assert.equal(s.checks.frozenOk, true);
});

test("arm: late Friday print delays arm until minFrozen", () => {
  const p = armPlan(sim(), [r(SAT - 60)]);
  assert.equal(p.time, SAT - 60 + 900);
  assert.equal(p.reason, undefined);
});

test("arm: quiet ticker (last print > 6h before window) is skipped with a reason", () => {
  const p = armPlan(sim(), [r(SAT - 7 * 3600)]);
  assert.match(p.reason!, /recent-close/);
});

test("arm: non-positive answer is skipped", () => {
  const p = armPlan(sim(), [r(SAT - 3600, 0n)]);
  assert.equal(p.reason, "answer <= 0");
});

test("arm: no feed -> pool-priced paper arm at window start + armDelay", () => {
  assert.deepEqual(armPlan(sim(), undefined), { time: SAT + 300, round: undefined });
});

test("settle: Monday 00:00 print -> settle at windowEnd + settleDelay", () => {
  const h = [r(SAT - 4 * 3600), r(MON)];
  const p = settlePlan(sim(), h, MON + 10 * 3600)!;
  assert.equal(p.time, MON + 3600);
  assert.equal(p.round!.updatedAt, MON);
});

test("settle: waits for the first fresh print, then it must be <= maxFreshAge old", () => {
  const h = [r(SAT - 4 * 3600), r(MON + 5 * 3600)];
  assert.equal(settlePlan(sim(), h, MON + 4 * 3600), undefined, "not yet");
  assert.equal(settlePlan(sim(), h, MON + 5 * 3600)!.time, MON + 5 * 3600);
});

test("settle: a print older than maxFreshAge rolls forward to the next print", () => {
  const h = [r(SAT - 4 * 3600), r(MON + 60), r(MON + 3 * 3600)];
  // at MON+1h the MON+60 print is 59 min old -> still fresh
  assert.equal(settlePlan(sim(), h, MON + 10 * 3600)!.round!.updatedAt, MON + 60);
  const h2 = [r(SAT - 4 * 3600), r(MON - 60), r(MON + 3 * 3600)];
  // print before windowEnd doesn't count -> next print
  assert.equal(settlePlan(sim(), h2, MON + 10 * 3600)!.time, MON + 3 * 3600);
});

test("settle: gives up after emergencyDelay", () => {
  const h = [r(SAT - 4 * 3600), r(MON + 100 * 3600)];
  assert.equal(settlePlan(sim(), h, MON + 200 * 3600), undefined);
});
