// Peak premium = the level held for 15 minutes: stray one-print spikes are ignored, real squeezes are kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { heldPeak } from "../src/tickerWindows.js";

const H = 900;
test("a one-print spike lasting seconds is ignored", () => {
  const path = [{ t: 0, prem: 0.02 }, { t: 1000, prem: 20.23 }, { t: 1010, prem: 0.03 }, { t: 5000, prem: 0.04 }];
  assert.ok(Math.abs(heldPeak(path, 10_000, H) - 0.04) < 1e-12, "the highest level actually held (0.04), not the 20.23 print");
});
test("a squeeze that holds for an hour is kept at the level it held", () => {
  const path = [{ t: 0, prem: 0 }, { t: 100, prem: 3.3 }, { t: 400, prem: 2.5 }, { t: 4000, prem: 0.1 }];
  assert.ok(Math.abs(heldPeak(path, 10_000, H) - 2.5) < 1e-12);
});
test("the last level counts only if it held until the window end for 15 minutes", () => {
  const path = [{ t: 0, prem: 0.01 }, { t: 9_500, prem: 5 }];
  assert.ok(Math.abs(heldPeak(path, 10_000, H) - 0.01) < 1e-12);
  assert.ok(Math.abs(heldPeak(path, 10_500, H) - 5) < 1e-12);
});
