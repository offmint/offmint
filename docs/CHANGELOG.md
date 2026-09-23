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
