import { test } from "node:test";
import assert from "node:assert/strict";
import { impactPct, stockDepthWithin10 } from "../src/screen.js";
import { usdToSqrtPriceX96, amountsForLiquidity, liquidityForStock } from "../../keeper/src/rangeMath.js";

const D = { feed: 8, stock: 18, usd: 6 };

for (const s0 of [true, false]) {
  const o = s0 ? "S0" : "S1";
  test(`${o}: impactPct inverts the exact USDG needed to move the pool +5%`, () => {
    const L = 10n ** 17n;
    const p = usdToSqrtPriceX96(30_00000000n, D, s0);
    const p5 = usdToSqrtPriceX96(31_50000000n, D, s0);
    const [lo, hi] = p < p5 ? [p, p5] : [p5, p];
    const a = amountsForLiquidity(L, s0 ? hi : lo, lo, hi); // position fully converted to USDG
    const usdgRaw = s0 ? a.amount1 : a.amount0;
    const imp = impactPct(L, p, s0, Number(usdgRaw) / 1e6);
    assert.ok(Math.abs(imp - 5) < 0.01, `impact ${imp}`);
    assert.ok(impactPct(L, p, s0, 1) < impactPct(L, p, s0, 1000), "monotonic");
    assert.equal(impactPct(0n, p, s0, 1), Infinity);
  });

  test(`${o}: stockDepthWithin10 equals the STOCK a position over [P, 1.1P] would hold`, () => {
    const p = usdToSqrtPriceX96(30_00000000n, D, s0);
    const p10 = usdToSqrtPriceX96(33_00000000n, D, s0);
    const [lo, hi] = p < p10 ? [p, p10] : [p10, p];
    const L = liquidityForStock(1000n * 10n ** 18n, lo, hi, s0);
    const d = stockDepthWithin10(L, p, s0);
    assert.ok(Math.abs(d - 1000) < 1, `depth ${d}`);
  });
}
