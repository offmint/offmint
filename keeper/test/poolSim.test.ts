// PoolSim against closed-form concentrated-liquidity math (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { PoolSim, sqrtAtTick, tickAtSqrt, amountsAt, liquidityFor } from "../src/poolSim.js";

const close = (a: number, b: number, rel = 1e-9, msg?: string) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), msg ?? `${a} != ${b}`);

test("tick <-> sqrt price agree with v4 TickMath", () => {
  for (const t of [-250_000, -60, 0, 59, 120_000]) {
    assert.equal(tickAtSqrt(sqrtAtTick(t) * (1 + 1e-10)), t);
    assert.equal(tickAtSqrt(sqrtAtTick(t) * (1 - 1e-10)), t - 1);
  }
});

test("prices at the v4 bounds clamp instead of throwing (drained pools)", () => {
  assert.equal(tickAtSqrt(sqrtAtTick(887_272)), 887_271);
  assert.equal(tickAtSqrt(sqrtAtTick(-887_272)), -887_272);
});

test("swap inside one range matches the closed form, both directions", () => {
  const S0 = sqrtAtTick(0);
  const L = 1e18;
  for (const zeroForOne of [false, true]) {
    const p = new PoolSim(S0);
    p.modify(-6000, 6000, L);
    const r = p.swap(zeroForOne, 1e15, 3000);
    const net = 1e15 * (1 - 0.003);
    const S1 = zeroForOne ? (L * S0) / (L + net * S0) : S0 + net / L;
    close(p.S, S1);
    close(r.amountOut, zeroForOne ? L * (S0 - S1) : L * (1 / S0 - 1 / S1));
    close(r.fee, 1e15 * 0.003);
    close(r.amountIn, 1e15);
  }
});

test("crossing a tick switches liquidity; a limit stops the swap and returns the rest", () => {
  const p = new PoolSim(sqrtAtTick(0) * 1.00001);
  p.modify(-600, 600, 1e18);
  p.modify(600, 1200, 5e18);
  const toEdge = 1e18 * (sqrtAtTick(600) - p.S);
  p.swap(false, (toEdge * 2) / (1 - 0.003), 3000); // twice what the first range can absorb
  assert.ok(p.tick >= 600 && p.tick < 1200, `tick ${p.tick}`);
  close(p.L, 5e18);
  close(p.S, sqrtAtTick(600) + toEdge / 5e18, 1e-9);
  const q = new PoolSim(sqrtAtTick(0) * 1.00001);
  q.modify(-600, 600, 1e18);
  const lim = sqrtAtTick(300);
  const r = q.swap(false, 1e30, 0, lim);
  close(q.S, lim);
  assert.ok(r.amountIn < 1e30);
});

test("our single-sided range fills as price passes it and absorbs flow (smaller move)", () => {
  const S0 = sqrtAtTick(0) * 1.00001;
  const base = () => { const p = new PoolSim(S0); p.modify(-20_000, 20_000, 1e18); return p; };
  const a = base();
  const b = base();
  // our stock is token0 here (price up = token0 becomes dearer): a range above the price holds only token0
  const [lo, hi] = [600, 1200];
  const Lown = liquidityFor(1e16, sqrtAtTick(lo), sqrtAtTick(hi), true);
  b.addOwn("r0", lo, hi, Lown);
  const buy = 5e16; // token1 in, pushes the price up through our range
  a.swap(false, buy, 3000);
  const rb = b.swap(false, buy, 3000);
  assert.ok(b.S < a.S, "our supply shrinks the move");
  const held = amountsAt(Lown, b.S, sqrtAtTick(lo), sqrtAtTick(hi));
  assert.ok(held.amount0 < 1e16 && held.amount1 > 0, "partly sold into token1");
  assert.ok((rb.feeToOwn.r0 ?? 0) > 0, "we earned a share of the fee");
  b.removeOwn("r0");
  close(b.L, 1e18);
});

test("crossing out of the last range leaves zero liquidity, and the swap stops at the boundary", () => {
  const p = new PoolSim(sqrtAtTick(0) * 1.00001);
  p.modify(-600, 600, 5_239_398_497_386_197);
  p.modify(-300, 600, 246_271_977_931_993);
  p.modify(-300, 600, -246_271_977_931_993 * 0.9999999999999); // leaves float residue at 600
  const r = p.swap(false, 1e30, 3000);
  assert.equal(p.L, 0);
  close(p.S, sqrtAtTick(600));
  assert.ok(r.amountIn < 1e30, "unspent input returned");
});

test("a limit already behind the price trades nothing (capped buyback when the pool is above the cap)", () => {
  const p = new PoolSim(sqrtAtTick(600) * 1.00001);
  p.modify(-6000, 6000, 1e18);
  const before = p.S;
  const r = p.swap(false, 1e15, 3000, sqrtAtTick(300)); // price up, but the cap is below the current price
  assert.equal(r.amountIn, 0);
  assert.equal(r.amountOut, 0);
  assert.equal(p.S, before);
});

test("setPrice rebuilds active liquidity from ticks", () => {
  const p = new PoolSim(sqrtAtTick(0) * 1.00001);
  p.modify(-600, 600, 1e18);
  p.modify(0, 1200, 2e18);
  p.setPrice(sqrtAtTick(900) * 1.00001);
  close(p.L, 2e18);
  p.setPrice(sqrtAtTick(-300) * 1.00001);
  close(p.L, 1e18);
});
