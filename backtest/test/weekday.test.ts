import { test } from "node:test";
import assert from "node:assert/strict";
import { windowStats } from "../src/weekday.js";

test("windowStats is time-weighted, not swap-weighted", () => {
  // 0-10h at 0%, a 1-second +50% print, then +12% for the remaining time up to 20h
  const s = windowStats(
    [
      { t: 0, prem: 0 },
      { t: 36_000, prem: 0.5 },
      { t: 36_001, prem: 0.12 },
    ],
    0,
    72_000,
    3,
  );
  assert.equal(s.maxPct, 50);
  assert.ok(Math.abs(s.timeAbove10Pct - 50) < 0.01, `time>10% ${s.timeAbove10Pct}`); // half the window at +12%/+50%
  assert.equal(s.p95Pct, 12, "a 1-second spike does not set the p95");
});

test("windowStats clips points outside the window", () => {
  const s = windowStats([{ t: -1000, prem: 0.2 }, { t: 50, prem: 0 }], 0, 100, 1);
  assert.equal(s.timeAbove10Pct, 50);
  assert.equal(s.maxPct, 20, "the state carried into the window counts");
});
