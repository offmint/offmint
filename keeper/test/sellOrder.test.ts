// Personal sell order levels are anchored to the verified reference, not the pool (both orientations).
import { test } from "node:test";
import assert from "node:assert/strict";
import { sellOrderRange, SellOrderError } from "../src/sellOrder.js";
import { usdToTick, tickToUsd, type Decimals } from "../src/rangeMath.js";

const d: Decimals = { feed: 8, stock: 18, usd: 6 };
const usd = (x: number) => BigInt(Math.round(x * 1e8));
const REF = 30;
const band = (r: { tickLower: number; tickUpper: number }, s0: boolean) =>
  [Number(tickToUsd(r.tickLower, d, s0)) / 1e8, Number(tickToUsd(r.tickUpper, d, s0)) / 1e8].sort((a, b) => a - b);
const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof SellOrderError ? e.code : "other"; } };

for (const s0 of [true, false]) {
  const o = `stock is currency${s0 ? 0 : 1}`;
  test(`${o}: level = reference x (1 + premium), rounded away from the price`, () => {
    const r = sellOrderRange(usd(REF), 1000, 1000, usdToTick(usd(REF), d, s0), 60, d, s0);
    const [lo, hi] = band(r, s0);
    assert.ok(lo >= REF * 1.1 && lo < REF * 1.1 * 1.007, `lower ${lo}`);
    assert.ok(hi <= REF * 1.2 && hi > REF * 1.2 * 0.993, `upper ${hi}`);
  });

  test(`${o}: pool already above the reference (+5%): the level still comes from the reference, not the pool`, () => {
    const poolTick = usdToTick(usd(REF * 1.05), d, s0);
    const [lo] = band(sellOrderRange(usd(REF), 1000, 1000, poolTick, 60, d, s0), s0);
    assert.ok(lo < REF * 1.05 * 1.1 * 0.99, `anchored to ${REF}, not to the pool: lower ${lo}`);
    assert.ok(lo >= REF * 1.1);
  });

  test(`${o}: pool already at or above the level (+15% vs a +10% order): refused, never shifted up`, () => {
    assert.equal(code(() => sellOrderRange(usd(REF), 1000, 1000, usdToTick(usd(REF * 1.15), d, s0), 60, d, s0)), "PoolAboveLevel");
    assert.equal(code(() => sellOrderRange(usd(REF), 1000, 1000, usdToTick(usd(REF * 1.1), d, s0), 60, d, s0)), "PoolAboveLevel");
  });

  test(`${o}: minimum premium +5% enforced`, () => {
    assert.equal(code(() => sellOrderRange(usd(REF), 499, 1000, usdToTick(usd(REF), d, s0), 60, d, s0)), "PremiumTooLow");
    assert.equal(code(() => sellOrderRange(usd(REF), 500, 1000, usdToTick(usd(REF), d, s0), 60, d, s0)), null);
  });
}
