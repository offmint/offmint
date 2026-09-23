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
