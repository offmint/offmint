import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDec, tokenPriceE8, toTokenPriceE8, track } from "../src/apiOracle.js";

test("parseDec is exact (no floats)", () => {
  assert.equal(parseDec("8.48", 8), 848_000_000n);
  assert.equal(parseDec("1.000775159164630595", 18), 1_000_775_159_164_630_595n);
  assert.equal(parseDec("225", 2), 22_500n);
  assert.throws(() => parseDec("-1", 8));
  assert.throws(() => parseDec("1e5", 8));
});

test("token price = mid x currentMultiplier (API is raw underlying)", () => {
  // NVDA quote 23 Sep 20:38 UTC: bid 225.32 / ask 225.36, multiplier 1.000775159164630595 -> Chainlink 225.5497
  const p = tokenPriceE8("225.32", "225.36", "1.000775159164630595");
  assert.equal(p, 22_551_467_436n); // mid 225.34 x 1.000775159... = $225.51467436
  assert.ok(Math.abs(Number(p) / 1e8 - 225.5497) / 225.5497 < 0.0005, "within 5 bp of the Chainlink print");
  assert.equal(tokenPriceE8("8.48", "8.52", "1.000000000000000000"), 850_000_000n); // BB, multiplier 1
});

test("never double-count the multiplier: Chainlink answers pass through unchanged", () => {
  const chainlink = 22_554_970_000n; // already multiplier-adjusted
  assert.equal(toTokenPriceE8({ kind: "chainlink", answerE8: chainlink }), chainlink);
  const raw = toTokenPriceE8({ kind: "api-raw", bid: "225.32", ask: "225.36", multiplier: "1.000775159164630595" });
  const doubled = (raw * 1_000_775_159_164_630_595n) / 10n ** 18n;
  assert.notEqual(raw, doubled, "applying the multiplier twice would change the price");
  assert.ok(doubled > raw);
});

test("observedAt only moves when the quote changes (weekends read as frozen)", () => {
  let r = track(undefined, 850_000_000n, 1000);
  assert.equal(r.post, true);
  assert.equal(r.state.observedAt, 1000);
  r = track(r.state, 850_000_000n, 5000); // same price hours later: no post, observedAt unchanged
  assert.equal(r.post, false);
  assert.equal(r.state.observedAt, 1000);
  r = track(r.state, 860_000_000n, 9000);
  assert.equal(r.post, true);
  assert.equal(r.state.observedAt, 9000);
});
