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

## Weekend runs
To be appended after 28 Sep from the summary log: posts vs skips per run, and error vs Chainlink while the feeds are
frozen (expected: the API quote is also the frozen close, so the error should stay small; wide spreads are skipped).
