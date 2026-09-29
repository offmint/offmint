# Mainnet price poster, read-only dry run (AIRTIGHT item 8)

`keeper/src/posterDryRun.ts` runs the PushPriceReference poster's method against mainnet with no transactions and no
keys: for every basket ticker, what it would post (or skip); for every ticker with a Chainlink feed, our API-derived
token price (mid of `/rhj/prices` bid/ask × `currentMultiplier`, applied once) vs the Chainlink answer.
Loop: every 30 min through the weekend of 26–28 Sep (`tmux offmint-poster-dryrun`), raw rows in
`keeper/logs/poster-dryrun.jsonl`, summaries in `keeper/logs/poster-dryrun-summary.jsonl`.

## Finding and fix before the run
The poster had **no spread check**: with an off-hours quote (INDA bid $43.44 / ask $52.03) it would have posted the
mid as the reference; only the 20%-per-post cap limited the damage. Fixed: `apiOracle.ts` now skips any quote with a
spread above 1% (`MAX_SPREAD_BPS = 100`) and logs why.

## First run: Thu 24 Sep 2026 09:25 UTC (US pre-market)
- Basket: 74 tickers → would post 50, would skip 24 (spread > 1%).
- vs Chainlink, 35 feed tickers: median |error| **0.125%**, max **0.431%** (34 with tight quotes: same figures).

## Weekend runs (25–28 Sep)
From the run summaries in `keeper/logs/poster-dryrun.log` (48 runs, Thu 24 Sep 23:42 to Sun 27 Sep 23:44 UTC) and the raw
rows in `poster-dryrun.jsonl`. The log has gaps (e.g. Sat 10:37 to 17:31) where no run completed.

| Period (UTC) | Would post / skip (of 74) | vs Chainlink, all 35 | vs Chainlink, tight quotes only (spread ≤ 1%) |
|---|---|---|---|
| Fri 25 Sep 19:31–23:37 (after-hours) | 51–74 / 0–23 | median 0.09–0.17%, max 0.46–1.48% | 34–35 quotes, median ≤ 0.17%, **max ≤ 0.49%** |
| Sat 00:08 to Sun 21:32 (weekend, 33 runs) | **11 / 63** | median 0.60%, max 43.7% | 12 quotes, median 0.25%, **max 0.49%** |
| Sun 23:44 (overnight session opening) | 11 / 63 | median 1.35%, max 45.5% | 12 quotes, median 0.79%, **max 3.10%** |

**1. The spread check did its job.** Over the weekend Robinhood's API quote froze at Friday's close and 63 of 74
spreads widened past 1%, so the poster would have posted only 11 (SOUN, MRNA, RCAT, IBM, UPS, SOXX, GEV, QUBT, ZM, LLY,
FIG). Every large error was on a quote it skips: USAR +43.7% (spread 62.6%), MSTR +8.1% (15.7%), SPCX +5.4% (10.1%),
TSM −5.2% (10.8%). Before the fix above, those mids would have been posted, limited only by the 20% cap.

**2. While the market is shut, the frozen quote is the right reference.** On tight quotes it matched the (also frozen)
Chainlink close within 0.49% the whole weekend. This is the Friday reference the vault's ladder is built on.

**3. Found: the API quote lags when trading resumes Sunday night.** By Sun 23:44 Chainlink had started updating again
(feeds 6–37 min old) while the API quote was still Friday's: NBIS $238.22 vs Chainlink $231.06 (+3.10%), IONQ +2.94%,
ASML +1.96%, GME +1.08%, all on tight spreads, so the poster would have posted them. The loop's last run was 23:44, so
the log does not show when the API quote caught up. Consequence: for roughly the first hour of the Sunday-night
session, a no-feed token's posted reference can be Friday's price, a few percent off. This only matters for Monday
settlement, which waits `settleDelay` (1 h) after reopen and requires a fresh reference (`maxFreshAge`); the next
weekend's log should confirm the API quote updates inside that hour. Not changed in code.
