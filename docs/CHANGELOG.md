# Changelog

## 2026-09-23
- M0: repo scaffold, Foundry project (v4-core v4.0.0, v4-periphery, OpenZeppelin v5.7.0; forge-std/solmate via v4-core).
- M0: on-chain fact checks. Testnet PoolManager exists (same bytecode as mainnet). No HIMS Chainlink feed. No sequencer
  uptime feed listed. Stock feeds are deviation-based. Testnet TSLA lacks `oraclePaused()`. See `docs/FACTS.md`.
- M0: `scripts/discover_pools.py` joins the Stock Token API, the Chainlink directory and v4 `Initialize` logs, and writes `contracts/config/mainnet.json`.
- M2: `SessionClock` (offset ±3h), `ManualSessionClock` (testnet demo only), `RangeMath` (both orientations,
  directed rounding, floor/ceil snapping for negative ticks, one-sided range, buyback cap). 21 unit + fuzz tests.
- Mocks: `MockFeed`, `MockStockToken`, `MockUSDG` (6 dec).
- M1: keeper paper mode + replay (`keeper/`). Exact bigint port of TickMath/RangeMath, cross-checked against Solidity vectors.
  Models the range position with concentrated-liquidity math on real v4 Swap logs. Needs no archive node: prices come
  from Swap logs, oracle history from `getRoundData`. Three variants: spec / lockOnFill / lockPreOpen.
- Finding: in the HIMS 28–31 Aug replay, the spec's hold-until-settle earns 0% ex-fees, because the spike reversed before
  settle. A lock step keeps +18.6%. See `docs/FACTS.md`.
- Renamed Offbell → Offmint. Monorepo root with npm workspaces (`npm test` runs everything). GitHub Actions CI.
- M3: `OffmintVault`: ERC-4626 (offset 3), Ownable2Step, bounded params, `arm` / `lock` / `settle` / `retryBuyback` /
  `emergencyUnwind` / `expireBuyback` / `redeemMixed`, direct PoolManager `unlock` flows, performance fee to an immutable
  `feeRecipient`, optional sequencer feed.
- `lock()` is an addition to SPEC §6.6 (awaiting approval): permissionless, allowed once the band is cleared or from
  windowEnd − 15 min, removes the position without trading. The HIMS replay shows the spec path earns 0% ex-fees without it.
- Tests: 72 vault integration tests (36 scenarios × both orientations) against a local v4 PoolManager, sequencer tests,
  handler-based invariants (6 properties, both orientations, smoke-checked for coverage), and 200 Solidity→TS
  cross-language RangeMath vectors (bit-exact).
- Keeper: arm/settle timing moved to `plan.ts` with unit tests; engine tests on synthetic swap streams. Fixed a TS
  rounding mismatch in `sqrtPriceX96ToUsd` (found by the cross-language vectors) and `-0` in output JSON.
- `lock()` approved and kept.
- M4: mainnet fork tests (`contracts/test/Fork.t.sol`) on real TSLA/USDG (S0, real Chainlink feed) and HIMS/USDG
  (S1, pool-seeded MockFeed): arm on the real pool, squeeze → lock → buyback (+9.3 STOCK on 30 deployed), gap-up cap, no-fill.
  They skip without `RH_MAINNET_RPC`, so CI is deterministic.
- M4: `backtest/` workspace (reuses the keeper engine) → `web/public/backtest/hims-2026-08-28.json`.
  +14.7% STOCK vs HODL ex-fees with lock; −0.15% for hold-to-settle.
- Zero-liquidity drain prints (a swap to MIN_TICK) are now outliers: excluded from stats and the chart, still applied to the position.
- Pool discovery run for all 35 feed tickers plus HIMS (36 in `contracts/config/mainnet.json`, 13 with stock = currency0).
  The script now merges instead of overwriting.
- Lint: `forge fmt` applied; `forge lint src` is clean with documented exclusions; CI runs fmt --check + lint.
  Zero keeper rejected.
- **Size fix:** `OffmintVault` was 26.5 KB, over EIP-170, and couldn't deploy. `RangeMath.sellPosition` / `sellRange` /
  `buybackSqrtCap` are now public linked-library functions, and `_fullySold` compares ticks. The vault is now 23.3 KB. CI runs
  `forge build --sizes`, which fails on oversize (verified).
- `settle` / `retryBuyback` return the STOCK bought, so the keeper can simulate them and set `minStockOut` to 99.5% of the quote.
- M5 backend: `script/Deploy.s.sol` (testnet stack, deploys PoolManager only if none exists), `script/DemoBuyer.s.sol`
  (demo market controls), keeper bot `keeper/src/bot.ts` with a pure `decide()` (unit-tested), ABI generated from forge
  artifacts (CI checks for drift), and `scripts/e2e-local.sh`. Fresh anvil → deploy → bot arm → squeeze → lock (band
  cleared) → Monday → bot settle → +8.45 STOCK / 100. CI runs it.
- Demo findings: the vault fixes `windowEnd` at arm (`closeWeekend` can't shorten an armed window), and a thin seed pool
  sends the buyback to PENDING_BUYBACK (correct cap behaviour). The demo pool is seeded with L=1e18.
- Testnet deploy (chain 46630): 19/19 txs succeeded (0.00013 ETH gas), 8/8 contracts verified on Blockscout. Vault `0xc3413BCcc6BAf64430FF0f0f56B9C2B1D9850bdA`; pool initialised at $28.84 with L=1e18 on the chain's own PoolManager. `contracts/deployments/46630.json` + broadcast log committed.
- Stress harness `keeper/src/stress.ts`: 40 random weekends × 12 depositors on anvil with time warps, real deploy
  script and bot; 0 invariant violations. It found a real keeper bug: viem caches `getBlockNumber()`, so `slot0()` could read
  a stale pool price right after a trade (it now reads `latest`). The bot now uses `createBot()` (reusable); its RPC retries
  8×/1.5 s for flaky public endpoints. CI runs a 10-epoch stress.
- The testnet demo script is resumable (it checks on-chain state before every step). Fixed a first-token parse bug in the lock check.
- M0.5 (SPEC §3.5) ran end to end. Screen of all 195 registry tokens (`contracts/config/screen.json`): 87,109 v4 pools,
  157 active, 140 thin or meme-adjacent, only 27 of those with a Chainlink feed. 8-weekend backtest of 10 candidates
  (`contracts/config/tickers.json`, `docs/curation.md`): **every feed-backed candidate behaved as a major (max weekend
  premium <= +3.7%)**. The only dislocation was HIMS +317.6% (29 Aug, a single weekend, no Chainlink feed). **Ship list: empty.**
  It is reported, not padded; the product decision is pending (see curation.md).
- Meme-adjacency tightened: a top-2 pool quoted in USDG, ETH/WETH or another stock token is not a memecoin (a literal
  "non-USDG" reading flagged nearly every ticker).
- Scan performance: block-by-timestamp lookup cut from ~30 to ~13 RPC calls, quiet-pool look-back capped, per-weekend
  resume cache, pool discovery and state caches.
- `backtest/src/weekday.ts`: weekday (live feed) vs weekend (frozen close) premium comparison.

## 2026-09-24
- M2/M3 (SPEC §3.6, §5.0): the price source is pluggable through `IPriceReference`. `ChainlinkPriceReference` checks answer > 0,
  `oraclePaused` and the sequencer with its grace period. `PushPriceReference` covers no-feed listings: a separate poster role,
  forward-only timestamps, a 20% per-post cap unless the gap is ≥ 12h, and a poster halt flag. It also has an **owner freeze**
  (`setOwnerHalt`) that blocks both posts and reads, and the poster cannot lift it; the owner and poster must be different
  addresses.
- M3: `OffmintVault` arms a **ladder** of up to 4 one-sided rungs (default `{800,400,2500} {1500,700,3000} {2500,1000,2500}
  {4000,1500,2000}`):
  - crossed rungs are skipped and rungs must not overlap;
  - the keeper can only be more conservative: the first-rung premium must be ≥ the default, and deploy ≤ the default;
  - `lock()` pulls each fully-sold rung as soon as it is sold, and every remaining rung from windowEnd − 15 min;
  - per-rung results are exposed through `epochRungs(id)`;
  - the owner can change the default ladder only while the vault is OPEN.
- Size: the pool flows moved to the linked library `VaultPoolOps` and param validation to `OffmintParams`, with optimizer_runs = 1.
  The vault is 23,590 B (986 B under EIP-170).
- Keeper: `decide()` arms with the vault's own default ladder, shifted up by the per-ticker premium floor. It locks on any sold
  rung. The bot reads the price reference, where a revert means paused. Local E2E: +6.41 STOCK / 100. Stress (10 epochs,
  8 users): 0 invariant violations.
- Contracts: 126 forge tests pass (the fork tests skip without an RPC, and pass with one: TSLA +7.08, HIMS +6.99 on 30 deployed).
- Backtest GLXY 11–14 Sep: +32.8% STOCK vs HODL ex-fees (lockOnFill). The MetaVault friction model gives 28.5% gross and
  25.1% net USD. The buy-in is approximated at the Friday close.
- `.detector-cache.json` (48 MB log cache) is gitignored. `contracts/config/basket.json` (the detector output) is committed.
- M3.5 (SPEC §6.5): `MetaVault`, a USDG ERC-4626 (`omMETA`, offset 6):
  - state machine: IDLE iff `openPositionCount == 0`; deposit/withdraw only when IDLE.
  - weekly cycle: `buyIn` (keeper) → `triggerEarlyUnwind` (anyone, BUY-IN→commit only) → `commit` (keeper; deposits
    into the ticker's OffmintVault before its ladder arms) → OffmintVault arm/lock/settle unchanged → `unwind` (anyone
    after the weekend; keeper may abort a BOUGHT position earlier).
  - BUY-IN: a pre-check (pool ≤ reference × (1 + buyInSlippageBps)) **and** the same cap as the swap's `sqrtPriceLimitX96`.
    The swap is `VaultPoolOps.swapExact`, the same capped primitive as settle's buyback.
  - UNWIND sells at no less than reference × (1 − unwindSlippageBps). Partial fills are kept for a later call. After
    the weekend, only a post-reopen print counts.
  - A realized loss above `weeklyLossCapBps` blacklists the ticker for `blacklistDays`, stop-loss exits included.
    `buyIn` refuses blacklisted tickers onchain (no keeper override).
  - `totalAssets` = USDG + committed sub-vault shares × reference + held STOCK × reference. It uses the ticker's own
    reference; a reverting reference falls back to the buy-in price, for display only.
  - `txFeeBps` (default 50, ≤ 200) on deposit and withdraw, using the fee-vault pattern (previews match execution).
    Fees go to the immutable `feeRecipient`.
- `VaultFactory` (§6.5.4): anyone can `deployVault(stock)` for an owner-listed canonical stock:
  - It wires a ChainlinkPriceReference (feed) or PushPriceReference (no feed, poster ≠ keeper, owner freeze) and
    requires an initialized hook-free STOCK/USDG pool.
  - OffmintVault's initcode is ~28 KB, too big to embed, so it is stored in data contracts and pinned by
    `vaultCodeHash`. The factory can only deploy that exact code.
- Keeper `select.ts` (§6.5.2): score = w1 × 7d volume growth % + w2 × top non-USDG pool share %. It picks ≤ maxConcurrent
  above `minScoreBps` and excludes skip/earnings and blacklisted tickers; zero picks is normal. It writes the whole
  scored table weekly.
- Tests: 25 MetaVault/factory tests, both orientations (A: stock = currency0 with Chainlink; B: currency1 with push):
  - full cycle IDLE→…→IDLE, NAV +0.44% on a +30% squeeze (30% alloc × 30% ladder deploy, net of fees);
  - a −5% no-squeeze week loses ≤ alloc × (move + slippage + fees);
  - the stop-loss fires, and its loss reaches the blacklist;
  - the stop-loss refuses while the issuer oracle is paused, trading is halted, or the owner freeze is on;
  - a buy-in sandwich partial-fills at the cap; the average fill is ≤ cap + LP fee;
  - `txFeeBps` is charged on deposit and withdraw, and share price is unchanged;
  - NAV is exact with one position armed and one still pre-arm;
  - factory rejections.
  In total: 151 forge tests; MetaVault is 19.1 KB and VaultFactory 11.2 KB.
- SPEC update (§6.1, §6.5.3, §6.5.4, §6.6), `restrictedDepositor` isolation:
  - `OffmintVault` has an immutable `restrictedDepositor`. `address(0)` is the community instance (`ob{TICKER}`,
    open, market-neutral for existing holders). Otherwise only that address may deposit or mint (`mb{TICKER}`,
    MetaVault's exclusive instance).
  - `VaultFactory.deployVault(stock, restrictedDepositor)` is owner-only per SPEC and keyed by the pair. Both
    instances share one price reference per stock.
  - MetaVault only ever uses its own instance and refuses any vault whose `restrictedDepositor` is not itself.
  - `isBlacklisted` is ticker-level: MetaVault's own loss above the cap, or a community-instance epoch in the last
    `blacklistDays` that lost more than `weeklyLossCapBps` of the STOCK it deployed.
  - `deployBps` is per instance, since each has its own params; both default to 3000 (the SPEC decision is pending).
- Tests: 28 MetaVault/factory tests, including:
  - a community deposit into the `mb` instance reverts, and MetaVault never touches the `ob` instance;
  - MetaVault rejects a registry that points it at a community instance;
  - a community-instance gap-up loss blocks MetaVault's next pick until `blacklistDays` pass.
- The fuzz test `testFuzz_sellRange` found a case where a narrow rung with the pool mid-band and tick spacing 200 has
  < 2 spacings left above market, so `RangeInvalid` is correct (the vault skips such a rung). The test now asserts
  exactly that condition.
- Deploy script: the testnet stack now deploys through `VaultFactory` (code uploaded and hash-pinned), `MetaVault`,
  and both instances. The E2E and stress runs use `forge script --slow`, because anvil automine left 7.9M-gas
  deploys pending.
- **Testnet redeploy (46630, approved):** 30/30 transactions, 0.00036 ETH gas, 14/14 contracts verified on Blockscout.
  - Deployed: VaultFactory (code sealed), MetaVault `0xDE1D…1AAC` (IDLE, 9,950.25 USDG), community instance
    `obmHIMS` `0x2ea8…4285` (100 mHIMS), MetaVault instance `mbmHIMS` `0x4DF1…193E` (restricted to MetaVault), one
    shared ChainlinkPriceReference over the MockFeed.
  - The testnet keeper bot was restarted on the new community vault; the two duplicate stale bots from the first
    demo were stopped.
- Keeper, MetaVault cycle (SPEC §6.5.2):
  - `metaDecide()` is pure and unit-tested (7 tests). Its checks run in order: stop-loss (fresh, unpaused reference,
    −earlyUnwindThresholdBps) → unwind (after the weekend, on a post-reopen print, once the instance is OPEN/OPEN_MIXED;
    retries every 15 min) → Friday commit (6h before the window, instance still OPEN) → BUY-IN (SELECT picks, Wed/Thu
    UTC, allocBps of the cycle base; blacklisted, stale, or already-above-cap picks are skipped).
  - `metaBot.ts` executes those decisions. `bot.ts` now runs every instance of a deployment in one process: the
    community vault, MetaVault's instance (skipped while empty), and MetaVault.
- `MetaVault.buyIn` reverts if the clock has no upcoming window (demo clock not scheduled), so no position can be
  recorded against a past weekend. DemoBuyer gains `scheduleWeekend(startIn, duration)`.
- `scripts/e2e-meta.sh` (CI): the unmodified keeper bot runs buy-in → commit → arm → +70% squeeze → lock → settle →
  unwind on anvil; MetaVault returns to IDLE with USDG NAV +2.05%. This is a thin demo pool, not a performance claim.
- M4: the fork tests now price no-feed tickers through the production `PushPriceReference`: a separate poster key
  posts forward-only prices under the 20% cap. GLXY was added, and it squeezed +186% on 12 Sep. On mainnet state all
  12 pass. Gain on 30 STOCK deployed through a squeeze → lock → buyback:
  - GLXY (push, S0): +7.07 STOCK
  - HIMS (push, S1): +7.09 STOCK
  - TSLA (Chainlink, S0): +6.99 STOCK
  - gap-up cap and no-fill cases pass for all three.
- Testnet MetaVault demo started: the keeper bot bought in with 2,985.07 USDG (30%) for a scheduled 40-min demo
  weekend. `scripts/demo-meta-testnet.sh` was made resumable after a wait-condition bug (it evaluated the condition once).
- M5 web (`web/`, Next.js 15 + wagmi v2 + viem + RainbowKit + Tailwind + recharts, its own lockfile):
  - `/` hero, GLXY + HIMS charts, and the risk disclosure on the page
  - `/app` MetaVault deposit/withdraw (approve → deposit, withdraw, redeem all), NAV, cycle state with per-position
    phases, countdown to Sat 00:00 UTC, past cycles from onchain events, jurisdiction notice
  - `/monitor` detector basket plus paper-keeper state from the Railway service
  - `/vault/[ticker]` community and MetaVault instances side by side, with rungs
  - `/backtest` HIMS and GLXY with the MetaVault friction view
  - `/paper` per-weekend results with charts
  - `scripts/export-abi.mjs` also writes `web/src/abi` and `web/src/config/addresses.46630.json`; CI checks both for
    drift and builds the app.
- Paper service: `GET /basket.json` (CORS), so `/monitor` shows the live detector output.
- **Testnet MetaVault cycle, live (M5 acceptance):** on a scheduled 40-min demo weekend the keeper bot autonomously ran
  buyIn → commit → arm (both instances) → lock (4/4 rungs sold) → settle (both) → unwind. Deposited 10,000 USDG,
  withdrew **10,103.71 USDG** (+1.04% after the 0.5% entry and 0.5% exit fees); NAV 9,950.25 → 10,154.22. This was a
  thin demo pool and a +70% squeeze, so it is not a performance claim. Tx hashes: `contracts/deployments/demo-meta-46630.json`.
- NEXT.md Task 1 (housekeeping):
  - One SPEC: `docs/SPEC.md` is canonical (merged from the root copy, which was a superset; the 36 docs-only lines
    were superseded Offbell/single-range text). The root copy was deleted. It stays private (gitignored).
  - RPC: the keeper bot and testnet scripts prefer `ALCHEMY_RH_TESTNET_URL`; mainnet reads already prefer
    `ALCHEMY_RH_MAINNET_URL`. The web app reads through a server-side proxy `/api/rpc/<chainId>` (read-only methods,
    so the Alchemy key never reaches the browser).
  - `web/railway.json` added for the web service.
- NEXT.md Task 2 (faucet): the mock tokens keep owner-only `mint`. A separate `Faucet` (testnet only) is pre-funded
  with 10,000,000 test USDG and 100,000 mHIMS and gives 1,000 test USDG + 10 mHIMS per address per 24 h. The owner can
  pause, change amounts, and sweep; anyone can refill by transferring. 5 tests: claim, second claim inside 24 h reverts,
  pause, empty reverts cleanly without starting the cooldown, sweep owner-only. Deployed and verified at
  `0xdB89850F763D3e29931c62550C150B7Dd82C596b`. The web `/app` "Get test tokens" button links the Robinhood testnet ETH faucet.
