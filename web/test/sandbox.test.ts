// The in-browser sandbox runs the real replay engine on synthetic weekends; the three presets must behave as described.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runSandbox, PRESETS } from "../src/lib/sandbox";

const run = (k: string) => runSandbox({ tokens: 100, refUsd: 30, ...PRESETS[k].s });

test("normal weekend: nothing sells, you keep exactly your tokens", () => {
  const r = run("normal");
  assert.equal(r.result.usdgReceived, 0);
  assert.ok(Math.abs(r.result.extraShares) < 1e-9, `extra ${r.result.extraShares}`);
});

test("big spike: steps sell above the reference, buyback returns more tokens than were sold", () => {
  const r = run("spike");
  assert.ok(r.result.usdgReceived > 0);
  assert.ok(r.result.extraShares > 0, `extra ${r.result.extraShares}`);
  assert.equal(r.result.state, "OPEN");
  for (const g of r.rungs) assert.ok(g.fromUsd >= r.refUsd * (1 + g.premiumPct / 100) * 0.999, "every step sits above the reference");
  assert.ok(r.peakWith <= r.peakWithout + 1e-9, "our orders never raise the peak");
});

test("spike then Monday opens higher: the capped buyback leaves USDG pending, and you can end with fewer tokens", () => {
  const r = run("bad");
  assert.ok(r.result.usdgReceived > 0);
  assert.ok(r.result.usdgLeft > 0 || r.result.extraShares < 0, `left ${r.result.usdgLeft} extra ${r.result.extraShares}`);
  assert.ok(r.result.extraShares < 0, "honest bad case: fewer tokens");
  assert.ok((r.result.buybackAvgUsd ?? 0) <= r.capUsd * 1.01, "never pays above the cap (incl. pool fee)");
});

test("capacity: the same spike in a thin pool leaves part of the buyback pending (the 1% cap binds)", () => {
  const r = runSandbox({ tokens: 100, refUsd: 30, ...PRESETS.spike.s, depth: "thin" });
  assert.equal(r.result.state, "PENDING_BUYBACK");
  assert.ok(r.result.usdgLeft > 0);
});
