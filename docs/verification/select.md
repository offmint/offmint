# SELECT: point-in-time validation (AIRTIGHT item 9)

**Verdict: not validated. SELECT would not have picked HIMS before its 29 Aug squeeze.** Per AIRTIGHT item 9, the site
and README now say MetaVault's picker is **experimental and unvalidated**, and the pitch leads with the community vault.

## Method
`keeper/src/selectBacktest.ts` (read-only mainnet). For each Thursday 12:00 UTC:
- **Basket as of that Thursday**: Robinhood registry tokens without a Chainlink feed whose first USDG pool is ≤ 30 days
  old at that time (the detector's rule).
- **Score** with the production `select()` / `volumeStats()` (`keeper/src/select.ts`, defaults w1 = w2 = 1, bar 100,
  max 2 picks), using only swaps before that Thursday (14-day window).
- **Outcome**: squeezes are taken from the published screen (`web/public/data/screen/weekends.json`, reference = pool
  price at Fri 20:00 UTC for no-feed tickers). The backtest's own busiest-pool measure is kept in the JSON but is
  noisy (junk pools gave DJT +7,031,650% and GLD +368,484%), so it is not used for hits and misses.

Outputs: `keeper/logs/select-bt-2026-08-27.json`, `keeper/logs/select-bt-2026-09-10.json`, and
`keeper/logs/select-backtest.log` (earlier weeks).

## Results
| Thursday | Basket | Picks | Screened squeeze (no feed) | Hit? |
|---|---|---|---|---|
| 30 Jul | 61 | NU, RBLX | none | no squeeze; 2 false picks |
| 6 Aug | 4 | none | none | correct (zero picks) |
| 13 Aug | 4 | none | none | correct (zero picks) |
| 20 Aug | not completed (run stopped for speed; no screened squeeze that weekend) | | | |
| **27 Aug** | 97 | **COHR, CRWD** | **HIMS +317.56%** | **missed** |
| **10 Sep** | GLXY_ROW | | | |

27 Aug scores (top 6): COHR 26,974,736 · CRWD 162,017 · **HIMS 11,621** · ALAB 8,944 · BB 4,408 · GLD 745.
Both picks had **zero weekend swaps** in their USDG pools, so a vault could not have sold anything into them.

## Why it missed
- **Growth is unbounded when prior volume is near zero.** Growth = (recent half − first half) / first half. A listing
  with almost no trading in the first half of the window (COHR, CRWD) gets growth in the hundreds of thousands of
  percent, far above HIMS. HIMS cleared the bar more than 100× over but ranked third with `maxConcurrent` = 2.
- **Nothing requires the pick to be tradable in USDG over the weekend.** Both picks had a 99–100% non-USDG share
  (volume in other quote pools), which the score rewards.

## What we did not do
Plausible fixes: a minimum prior volume, capping growth, requiring USDG-pool depth. Tuning them on the same two
events we are testing against would be overfitting, so the defaults are unchanged. Any change needs out-of-sample
weekends (Oct 3–4 onward) before the picker is described as working.
