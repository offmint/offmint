import { test } from "node:test";
import assert from "node:assert/strict";
import { curatedUniverse } from "../src/paper.js";

test("paper universe = thin + watch + squeeze-prone no-feed flagship + liquid controls", () => {
  const cur = {
    tickers: {
      HIMS: { bucket: "ineligible", reason: "no Chainlink feed ...; squeeze-prone: flagship backtest example" },
      DEAD: { bucket: "ineligible", reason: "no usable weekend data (pool too inactive)" },
      GME: { bucket: "thin", reason: "3/12" },
      RKLB: { bucket: "watch", reason: "max +7%" },
      NVDA: { bucket: "liquid", reason: "..." },
      SPY: { bucket: "liquid", reason: "..." },
      AAPL: { bucket: "liquid", reason: "..." },
    },
  };
  assert.deepEqual(curatedUniverse(cur, ["NVDA", "SPY", "MISSING"]), ["GME", "HIMS", "NVDA", "RKLB", "SPY"]);
});
