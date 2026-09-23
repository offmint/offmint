import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, DEFAULTS, type Candidate } from "../detector/detector.js";

const ok: Candidate = { ticker: "GLXY", token: "0xg", inRegistry: true, onchainSymbol: "GLXY", onchainDecimals: 18, hasFeed: false, poolAgeDays: 4, depthUsdTo10: 50_000 };

test("§3.7: a fresh, verified, no-feed, liquid listing is a basket member (push-price path)", () => {
  assert.deepEqual(judge(ok, DEFAULTS), { member: true, path: "push-price" });
});

test("§3.7 step 2: verification comes first; copycats never enter", () => {
  const r = judge({ ...ok, inRegistry: false }, DEFAULTS);
  assert.equal(r.member, false);
  assert.match((r as any).reason, /canonical/);
  assert.match((judge({ ...ok, onchainSymbol: "GLXY2" }, DEFAULTS) as any).reason, /symbol/);
  assert.match((judge({ ...ok, onchainDecimals: 6 }, DEFAULTS) as any).reason, /decimals/);
  // even a copycat that would otherwise qualify on every other rule is rejected on verification
  assert.equal(judge({ ...ok, inRegistry: false, hasFeed: false, poolAgeDays: 1 }, DEFAULTS).member, false);
});

test("§3.7 step 3: a live feed graduates the token out; old pools leave the window", () => {
  assert.match((judge({ ...ok, hasFeed: true }, DEFAULTS) as any).reason, /graduated/);
  assert.equal(judge({ ...ok, poolAgeDays: 30 }, DEFAULTS).member, true, "window boundary inclusive");
  assert.match((judge({ ...ok, poolAgeDays: 34 }, DEFAULTS) as any).reason, /window/, "HIMS today");
  assert.match((judge({ ...ok, poolAgeDays: null }, DEFAULTS) as any).reason, /no hook-free/);
});

test("§3.7 step 4: liquidity floor", () => {
  assert.match((judge({ ...ok, depthUsdTo10: 1_999 }, DEFAULTS) as any).reason, /floor/);
  assert.equal(judge({ ...ok, depthUsdTo10: 2_000 }, DEFAULTS).member, true);
  assert.equal(judge({ ...ok, depthUsdTo10: 500 }, { ...DEFAULTS, minDepthUsd: 100 }).member, true, "configurable");
});
