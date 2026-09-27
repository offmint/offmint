import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeLastSwaps, LOOKBACK_SEC } from "../src/lastSwaps.js";

const A = "0xAA", B = "0xbb", C = "0xcc";
const now = 1_790_000_000;

test("keeps the latest swap per basket pool, ignores zero-liquidity swaps and non-basket pools", () => {
  const out = mergeLastSwaps({}, [
    { poolId: A as any, ts: now - 100, liquidity: 5n },
    { poolId: A as any, ts: now - 50, liquidity: 5n },
    { poolId: A as any, ts: now - 10, liquidity: 0n }, // drained range: not a trade at a real price
    { poolId: C as any, ts: now - 5, liquidity: 5n }, // not in the basket
  ], [A, B], now);
  assert.deepEqual(out, { "0xaa": now - 50 });
});

test("drops entries older than the look-back and pools that left the basket", () => {
  const out = mergeLastSwaps({ "0xaa": now - LOOKBACK_SEC - 1, "0xbb": now - 60, "0xcc": now - 60 }, [], [A, B], now);
  assert.deepEqual(out, { "0xbb": now - 60 });
});
