# Claims ledger (AIRTIGHT ground rule 2)

Every public number or claim, where it comes from, and its status. Generated from `web/public/data/*` (last update 2026-09-26). `web/test/claims.test.ts` checks every row marked (tested) against its data file. Nothing `unverified` is used on the landing page.

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
| MetaVault picker (SELECT) | experimental, coming later: missed HIMS (picked COHR, CRWD) | keeper/logs/select-bt-2026-08-27.json; docs/verification/select.md | verified (negative result) | landing explainer, /app banner, /vault, README |
| Testnet MetaVault cycle | 10000.0 in, 10103.706316 out | testnet/demo-meta.json (tx hashes, Blockscout) | verified (testnet, thin demo pool, simulated squeeze) | verify, README |
| Test counts | 160 contract, 12 fork, 102 keeper+backtest | tests.json; CI fails if the forge or keeper+backtest count differs | verified | verify, README |
| Ladder / limits | steps [8, 15, 25, 40]; stop-loss 8%, alloc 30%, loss cap 10%, blacklist 28 d, fee 0.5% | params.json parsed from contracts/src; test compares | verified | hero, how it works, sandbox |
| HIMS replay +14.7% vs hold | +14.7% | backtest/hims-2026-08-28.json lockOnFill | simulated | README only (labelled) |
| Tokenization window Mon 02:00 - Sat 02:00 CET/CEST, closed US holidays | - | docs.robinhood.com/chain/stock-tokens/, robinhood.com/eu/en/support/articles/about-stock-tokens | verified | week strip, README |
| Countdown to minting off | live | SessionClock rule (Sat 00:00 -> Mon 00:00 UTC) | live-computed | stat band |
| New listings in the window now | live | /api/live <- Railway /basket.json (detector) | live-computed | stat band |
| Highest verified live premium | live or 'None' | /api/live quality gate (liveGate.ts) | live-computed (verified-only) | stat band, live table |
| Stress test: 0 invariant violations, one weekend -0.49% | - | npm run stress (keeper/src/stress.ts) | simulated | README |
| Community vault, big spike weekend, per $1,000 | +3.8% (HIMS 29 Aug) to +7.1% (GLXY 12 Sep) | supply/replay.json (with-supply replay, ex-LP-fees, after 10% fee) | simulated | landing explainer, README top |
| Normal weekend | ~0%: nothing sells on 191 of 198 ticker-weekends | supply/replay.json | simulated | landing explainer, README top |
| Worst replayed weekend | -0.1% (NU 12 Sep), mostly the $1 gas per weekend | supply/replay.json | simulated | landing explainer, README top |
| Monday buyback capacity per pool | median $1,647 (range $0 to $5,198, 5 capped weekends) | supply/replay.json ($100k runs, USDG bought back before the 1% cap) | simulated | landing explainer, README top |
| Value of buys priced >5% above the reference, 12 windows since 1 Jul | $17,594,088 (121,905 buys) | harm.json totals.above5pct.usdPaid | verified (observed onchain) | /weekends |
| Paid above the reference on those buys | $3,615,154 | harm.json totals.above5pct.usdAboveReference (= value − tokens × reference) | verified (observed onchain) | /weekends |
| Wallets behind those buys | 23,291 (bots and aggregators included) | harm.json totals.above5pct.uniqueSenders (unresolvedTxs = 0) | verified (observed onchain) | /weekends |
| Same at 2% (detail) | $32,889,731 of buys, $4,074,871 above the reference, 38,844 wallets | harm.json totals.above2pct | verified (observed onchain) | /weekends detail |
| 25 Jul window (definition check) | $109,866 of buys, $24,775 above the reference (5%); the earlier "$28,328" was the same excess at 2%: $28,328 | harm.json windows[2026-07-25] | verified (observed onchain) | /weekends |
| Premium >10% held 1h+ on at least one eligible token | 4 of 11 windows (36.4%, "about 1 in 3"); 3.6% of eligible token-windows | frequency.json eligible (depth >= $10k) | verified (observed onchain) | /weekends (method), report |
| Minting off, 2026 | 2,736 h of 8,760 h = 31.23% | mintoff.json (Robinhood window + NYSE holidays; holiday 02:00–02:00 Berlin assumption) | verified (computed from sources) | C1 section (pending) |
| Sell order contracts (testnet) | PositionManager 0x58daec3116aae6D93017bAAea7749052E8a04fA7, Permit2 0x000000000022D473030F116dDEE9F6B43aC78BA3 | docs/verification/sellorder-gate.md (fork run) | verified (fork) | /sell, README |
| Sandbox | illustrative market, real vault rules | web/src/lib/sandbox.ts on keeper/src/supplyReplay.ts | simulated | /sandbox |

## Removed or corrected
| Was | Now | Why |
|---|---|---|
| Live stat "highest live premium" (showed INDA +24.96%) | "highest verified live premium" | reference quotes off-hours are too wide (docs/verification/premiums.md) |
| "Every feed-backed ticker stayed under ~4%" | largest names within a few percent; MSTR (has a feed) +243.3% | MSTR was a real squeeze (docs/verification/mstr.md) |
| Hero "Friday price $29.87" derived from +317.6% | reference read from the screen data ($29.8653, pool @ Fri 20:00 UTC) | ground rule 1 |
| GLXY worked example 106.36 (unpinned fork) | 106.31 @ block 71241990 | fork pinned (item 13) |
| Company logos (Parqet/FMP) | Robinhood token icon next to ticker badge | wrong-company risk (item 4) |
| Old landing +8.1% / +0.44% (MetaVault) | removed everywhere | MetaVault is one line, experimental (DECISIONS D2) |
| Wallets 21,419 (5%) / 35,988 (2%) | 23,291 / 38,844 | undercount: some sender lookups had failed silently under RPC rate limits; harm.json now reports unresolvedTxs (0) and a test fails if any are left (26 Sep) |
| "$3.62M overpaid" | "value of buys" and "paid above the reference", both shown | ambiguous and not a loss (DECISIONS D6, FINISH B1) |
| "Two ways in" section | community vault only + MetaVault one line | pitch simplification (DECISIONS D2) |
