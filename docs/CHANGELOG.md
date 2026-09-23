# Changelog

## 2026-09-23
- M0: repo scaffold, Foundry project (v4-core v4.0.0, v4-periphery, OpenZeppelin v5.7.0; forge-std/solmate via v4-core).
- M0: on-chain fact checks. Testnet PoolManager exists (same bytecode as mainnet). No HIMS Chainlink feed. No sequencer
  uptime feed listed. Stock feeds are deviation-based. Testnet TSLA lacks `oraclePaused()`. See `docs/FACTS.md`.
- M0: `scripts/discover_pools.py` joins the Stock Token API, the Chainlink directory and v4 `Initialize` logs, and writes `contracts/config/mainnet.json`.
- M2: `SessionClock` (offset ±3h), `ManualSessionClock` (testnet demo only), `RangeMath` (both orientations,
  directed rounding, floor/ceil snapping for negative ticks, one-sided range, buyback cap). 21 unit + fuzz tests.
- Mocks: `MockFeed`, `MockStockToken`, `MockUSDG` (6 dec).
