import { test } from "node:test";
import assert from "node:assert/strict";
import { getSqrtPriceAtTick, getTickAtSqrtPrice, MIN_TICK, MAX_TICK, MIN_SQRT_PRICE, MAX_SQRT_PRICE, Q96 } from "../src/tickMath.js";
import { sellRange, tickToUsd, usdToTick, amountsForLiquidity, liquidityForStock, type Decimals } from "../src/rangeMath.js";
import { dow, windowStart, windowEnd, inWeekendWindow } from "../src/clock.js";

const d: Decimals = { feed: 8, stock: 18, usd: 6 };

test("TickMath anchors", () => {
  assert.equal(getSqrtPriceAtTick(0), Q96);
  assert.equal(getSqrtPriceAtTick(MIN_TICK), MIN_SQRT_PRICE);
  assert.equal(getSqrtPriceAtTick(MAX_TICK), MAX_SQRT_PRICE);
  for (const t of [-242_391, -1, 1, 60, 216_939, 500_000]) {
    assert.equal(getTickAtSqrtPrice(getSqrtPriceAtTick(t)), t);
    assert.equal(getTickAtSqrtPrice(getSqrtPriceAtTick(t) + 1n), t);
    assert.equal(getTickAtSqrtPrice(getSqrtPriceAtTick(t) - 1n), t - 1);
  }
});

test("matches Solidity vectors (forge test_vectors)", () => {
  // Emitted by contracts/test/RangeMath.t.sol::test_vectors
  assert.equal(usdToTick(30_00000000n, d, true), -242311);
  assert.equal(usdToTick(30_00000000n, d, false), 242310);
});

test("sell range invariants, both orientations", () => {
  for (const s0 of [true, false]) {
    for (const p0 of [1_000000n, 28_84000000n, 378_35925000n, 9_999_00000000n]) {
      for (const curMul of [5000n, 10000n, 11500n]) {
        const cur = usdToTick((p0 * curMul) / 10000n, d, s0);
        const { tickLower, tickUpper } = sellRange(p0, 1000n, 5000n, cur, 60, d, s0);
        const minUsd = (p0 * 11000n) / 10000n;
        if (s0) {
          assert.ok(cur < tickLower);
          assert.ok(tickToUsd(tickLower, d, true) >= minUsd);
        } else {
          assert.ok(tickUpper <= cur);
          assert.ok(tickToUsd(tickUpper, d, false) >= minUsd);
        }
      }
    }
  }
});

test("position fully converts across the range", () => {
  for (const s0 of [true, false]) {
    const p0 = 30_00000000n;
    const { tickLower, tickUpper } = sellRange(p0, 1000n, 5000n, usdToTick(p0, d, s0), 60, d, s0);
    const sa = getSqrtPriceAtTick(tickLower), sb = getSqrtPriceAtTick(tickUpper);
    const q = 100n * 10n ** 18n;
    const L = liquidityForStock(q, sa, sb, s0);
    const outside = amountsForLiquidity(L, s0 ? sa - 1n : sb + 1n, sa, sb);
    const stockHeld = s0 ? outside.amount0 : outside.amount1;
    assert.ok(q - stockHeld < 10n ** 6n && stockHeld <= q, `stock ${stockHeld}`);
    const through = amountsForLiquidity(L, s0 ? sb + 1n : sa - 1n, sa, sb);
    const usdg = s0 ? through.amount1 : through.amount0;
    // 100 stock sold across [33, ~48] -> between 3300 and 4800 USDG (6 dec)
    assert.ok(usdg > 3300_000000n && usdg < 4800_000000n, `usdg ${usdg}`);
  }
});

test("clock mirrors SessionClock", () => {
  const SAT = 1790380800; // Sat 26 Sep 2026 00:00 UTC
  assert.equal(dow(SAT), 6);
  assert.equal(windowStart(SAT + 3600), SAT);
  assert.equal(windowEnd(SAT - 1), SAT - 5 * 86400);
  assert.ok(inWeekendWindow(SAT) && !inWeekendWindow(SAT - 1) && !inWeekendWindow(SAT + 2 * 86400));
  assert.equal(windowStart(SAT + 1800, 3600), SAT - 7 * 86400 + 3600);
});
