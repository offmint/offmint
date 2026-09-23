// The TS port must reproduce the Solidity RangeMath bit-for-bit.
// Vectors come from contracts/test/RangeMath.t.sol::test_writeCrossLanguageVectors (run `forge test` to refresh).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { usdToSqrtPriceX96, sqrtPriceX96ToUsd, sellRange, buybackSqrtCap, type Decimals } from "../src/rangeMath.js";

const d: Decimals = { feed: 8, stock: 18, usd: 6 };
const vectors = JSON.parse(readFileSync(new URL("../../contracts/test/vectors/rangeMath.json", import.meta.url), "utf8")) as any[];

test(`${vectors.length} Solidity vectors (both orientations, ranges + RangeInvalid)`, () => {
  assert.ok(vectors.length >= 200);
  for (const [i, v] of vectors.entries()) {
    const p0 = BigInt(v.p0);
    assert.equal(usdToSqrtPriceX96(p0, d, v.s0, false).toString(), v.sqrt, `sqrt #${i}`);
    assert.equal(usdToSqrtPriceX96(p0, d, v.s0, true).toString(), v.sqrtUp, `sqrtUp #${i}`);
    assert.equal(sqrtPriceX96ToUsd(BigInt(v.sqrt), d, v.s0).toString(), v.usdBack, `usdBack #${i}`);
    assert.equal(buybackSqrtCap(p0, 100n, d, v.s0).toString(), v.cap, `cap #${i}`);
    let got: [number, number] | null;
    try {
      const r = sellRange(p0, BigInt(v.prem), BigInt(v.width), v.cur, v.spacing, d, v.s0);
      got = [r.tickLower, r.tickUpper];
    } catch {
      got = null;
    }
    assert.deepEqual(got, v.range, `sellRange #${i} ${JSON.stringify(v)}`);
  }
});
