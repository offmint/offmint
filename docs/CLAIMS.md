# Claims ledger (AIRTIGHT ground rule 2)

Every public number or claim, where it comes from, and its status. Generated from `web/public/data/*` on 2026-09-24. Nothing `unverified` is used on the landing page.

| Claim | Value | Source | Status | Where shown |
|---|---|---|---|---|
| HIMS peak weekend premium | +317.56% | screen/weekends.json (curate.ts, every swap; ref = pool @ Fri 20:00 UTC $29.8653) | verified | hero, stat band, evidence, README |
| GLXY peak weekend premium | +186.09% | screen/weekends.json (ref = pool @ Fri 20:00 UTC $24.3749) | verified | evidence, README |
| MSTR peak weekend premium (has a feed) | +243.31% | screen/weekends.json (ref = Chainlink close); cross-checked in docs/verification/mstr.md | verified | evidence bars, README |
| RKLB largest weekend premium | +35.83% | screen/weekends.json | verified | evidence bars |
| Large caps (NVDA, TSLA, AAPL, SPY) largest | +2.62% | screen/weekends.json | verified | evidence bars |
| HIMS weekday 95th percentile | +0.41% | backtest/weekday-vs-weekend.json | verified | evidence bars |
| Hero replay: HIMS candles, steps sold-through times | times from data | backtest/hims-2026-08-28.json timeline + params.json ladder | verified (real swaps); step fills are hypothetical | hero |
| HIMS NYSE close | $28.84 | backtest/hims-2026-08-28.json event.p0 (NYSE close, SPEC §10) | verified | hero caption, evidence caption |
| Worked example: GLXY 100 -> 106.31 | 106.31 GLXY, $957.43 collected | sim/fork.json, mainnet fork @ block 71241990 | simulated | how it works |
| Fork results TSLA/HIMS/GLXY | 106.32 / 106.37 / 106.31 | sim/fork.json @ block 71241990 | simulated | README proof |
| MetaVault picker (SELECT) | experimental and unvalidated: missed HIMS (picked COHR, CRWD) | keeper/logs/select-bt-2026-08-27.json; docs/verification/select.md | verified (negative result) | two ways, /app, risk disclosure, README |
| Testnet MetaVault cycle | 10000.0 in, 10103.706316 out | testnet/demo-meta.json (tx hashes, Blockscout) | verified (testnet, thin demo pool, simulated squeeze) | verify, README |
| Test counts | 160 contract, 12 fork, 76 keeper+backtest | tests.json; CI fails if forge count differs | verified | verify, README |
| Ladder / limits | steps [8, 15, 25, 40]; stop-loss 8%, alloc 30%, loss cap 10%, blacklist 28 d, fee 0.5% | params.json parsed from contracts/src; test compares | verified | two ways, hero, how it works |
| Whole-vault +0.44%, ladder capital +8.1% | +0.44% / +8.1% | contracts/test/MetaVault.t.sol test_fullCycle_squeeze_navUp_A (logged) | simulated | README only (labelled) |
| HIMS replay +14.7% vs hold | +14.7% | backtest/hims-2026-08-28.json lockOnFill | simulated | README only (labelled) |
| Tokenization window Mon 02:00 - Sat 02:00 CET/CEST, closed US holidays | - | docs.robinhood.com/chain/stock-tokens/, robinhood.com/eu/en/support/articles/about-stock-tokens | verified | week strip, README |
| Countdown to minting off | live | SessionClock rule (Sat 00:00 -> Mon 00:00 UTC) | live-computed | stat band |
| New listings in the window now | live | /api/live <- Railway /basket.json (detector) | live-computed | stat band |
| Highest verified live premium | live or 'None' | /api/live quality gate (liveGate.ts) | live-computed (verified-only) | stat band, live table |
| Stress test: 0 invariant violations, one weekend -0.49% | - | npm run stress (keeper/src/stress.ts) | simulated | README |

## Removed or corrected
| Was | Now | Why |
|---|---|---|
| Live stat "highest live premium" (showed INDA +24.96%) | "highest verified live premium" | reference quotes off-hours are too wide (docs/verification/premiums.md) |
| "Every feed-backed ticker stayed under ~4%" | largest names within a few percent; MSTR (has a feed) +243.3% | MSTR was a real squeeze (docs/verification/mstr.md) |
| Hero "Friday price $29.87" derived from +317.6% | reference read from the screen data ($29.8653, pool @ Fri 20:00 UTC) | ground rule 1 |
| GLXY worked example 106.36 (unpinned fork) | 106.31 @ block 71241990 | fork pinned (item 13) |
| Company logos (Parqet/FMP) | Robinhood token icon next to ticker badge | wrong-company risk (item 4) |
| Old landing +8.1% / +0.44% | README only, labelled simulated | not on the landing page |
