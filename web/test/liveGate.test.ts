import { test } from "node:test";
import assert from "node:assert/strict";
import { gate, tokenRef } from "../src/lib/liveGate";

const good = {
  poolUsd: 101,
  tvlUsd: 300_000,
  depthUsdTo10: 25_000,
  lastSwapAgeSec: 600,
  ref: { bid: 99.8, ask: 100.2, halted: false },
  independentUsd: 100.5,
};

test("all checks pass -> verified, premium vs token-adjusted mid", () => {
  const r = gate(good);
  assert.equal(r.verified, true, r.reasons.join("; "));
  assert.equal(r.refUsd, 100);
  assert.ok(Math.abs(r.premiumPct! - 1) < 1e-9);
});

test("INDA case: wide off-hours quote (bid 43.44 / ask 52.03) is not a reference", () => {
  const r = gate({ ...good, poolUsd: 48.04, ref: { bid: 43.44, ask: 52.03, halted: false }, independentUsd: 48 });
  assert.equal(r.verified, false);
  assert.match(r.reasons.join(), /spread 18\.0%/);
});

test("each gate fails on its own", () => {
  assert.match(gate({ ...good, tvlUsd: 9_999 }).reasons.join(), /TVL/);
  assert.match(gate({ ...good, depthUsdTo10: 4_000 }).reasons.join(), /thin pool/);
  assert.match(gate({ ...good, lastSwapAgeSec: 7 * 3600 }).reasons.join(), /stale pool/);
  assert.match(gate({ ...good, lastSwapAgeSec: null }).reasons.join(), /stale pool/);
  assert.match(gate({ ...good, ref: { ...good.ref, halted: true } }).reasons.join(), /halt/);
  assert.match(gate({ ...good, independentUsd: 110 }).reasons.join(), /GeckoTerminal/);
  assert.match(gate({ ...good, independentUsd: null }).reasons.join(), /unavailable/, "source down -> unverified, never verified");
});

test("multiplier applied exactly once: tokenBid/tokenAsk already include it (CRWD, multiplier 4)", () => {
  const q = { bid: "259.06", ask: "259.48", tokenBid: "1036.240000000000000000", tokenAsk: "1037.920000000000000000", isTradingHalt: false };
  const r = tokenRef(q)!;
  assert.equal(r.bid, 1036.24, "uses the token-adjusted field");
  assert.notEqual(r.bid, 259.06 * 4 * 4, "never multiplied again");
  assert.equal(tokenRef({ tokenBid: "0", tokenAsk: "1" }), null);
});
