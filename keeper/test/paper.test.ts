import { test } from "node:test";
import assert from "node:assert/strict";
import { curatedUniverse } from "../src/paper.js";

test("paper universe = picks + dislocation-prone + single-spike names + major controls", () => {
  const cur = {
    rules: { dislocationPct: 15 },
    tickers: {
      GME: { bucket: "dislocation-prone", ship: true, summary: { maxPremiumPct: 40 } },
      XYZ: { bucket: "dislocation-prone", ship: false, summary: { maxPremiumPct: 30 } }, // no feed: evidence only
      HIMS: { bucket: "neither", ship: false, summary: { maxPremiumPct: 317 } }, // single spike
      RKLB: { bucket: "neither", ship: false, summary: { maxPremiumPct: 7 } },
      DEAD: { bucket: "ineligible", ship: false, summary: { maxPremiumPct: 0 } },
      NVDA: { bucket: "major", ship: false, summary: { maxPremiumPct: 0.9 } },
      SPY: { bucket: "major", ship: false, summary: { maxPremiumPct: 0.6 } },
      AAPL: { bucket: "major", ship: false, summary: { maxPremiumPct: 1 } },
    },
  };
  assert.deepEqual(curatedUniverse(cur, ["NVDA", "SPY", "MISSING"]), ["GME", "HIMS", "NVDA", "SPY", "XYZ"]);
});
