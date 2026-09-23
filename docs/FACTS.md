# On-chain fact checks (M0)

Checked 2026-09-23 against live RPCs. Machine-readable versions: `contracts/config/mainnet.json`, `contracts/config/testnet.json`.
Regenerate mainnet with `python3 scripts/discover_pools.py [TICKER ...]` (needs Foundry's `cast` on PATH).

## Verified

| Fact | Result | How |
|---|---|---|
| Chain IDs | mainnet 4663 (0x1237), testnet 46630 (0xb626) | `eth_chainId` |
| v4 PoolManager mainnet | `0x8366a39cc670b4001a1121b8f6a443a643e40951` has code | `cast code` |
| v4 PoolManager testnet | **Deployed at the same address**, runtime bytecode keccak identical to mainnet (`0xbd38…5626`). No need to deploy our own. | `cast code` + `cast keccak` |
| USDG mainnet | `0x5fc5…d168`, symbol USDG, 6 decimals | `decimals()` |
| WETH mainnet / testnet | both have code | `cast code` |
| Stock token registry | `GET https://api.robinhood.com/rhj/assets` (195 assets). The docs page loads its table from here. | curl |
| TSLA mainnet | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d`, 18 dec, `uiMultiplier()` = 1e18, `oraclePaused()` = false | `cast call` |
| HIMS mainnet | `0xCceE82fE024c36fA15E1005edE3E9e4787e23D09`, 18 dec, `uiMultiplier()` = 1e18, `oraclePaused()` = false | `cast call` |
| Chainlink feed list | `https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json`: 58 feeds, 35 "Robinhood X / USD" equity feeds, all 8 decimals, heartbeat 86400s, market hours `us_equities_24/5` | curl |
| TSLA feed | `0x4A1166a659A55625345e9515b32adECea5547C38` ("RHTSLA / USD"), 8 dec | `latestRoundData()` |
| Pool orientation | Both occur on mainnet: TSLA/USDG has **stock = currency0** (S0); HIMS/USDG has **stock = currency1** (S1) | address sort + Initialize logs |
| Pool price sanity | TSLA 0x8517… pool (fee 3000, spacing 60, no hook) implied $379.29 vs feed $378.36 | slot0 via `extsload` |

## Findings that differ from SPEC / CLAUDE.md

1. **No Chainlink HIMS feed on Robinhood mainnet.** HIMS can only be used for the backtest (SPEC §10 already falls back to $28.84) and for paper mode with a pool-derived or manual P0. A live HIMS vault cannot pass the oracle checks. Demo tickers with feeds: TSLA, NVDA, AAPL, AMZN, META, MSFT, GOOGL, COIN, PLTR, MSTR, AMD, SPY, QQQ, …
2. **No L2 sequencer uptime feed is listed for robinhood-mainnet.** SPEC §4.3 assumes one on mainnet and skips the check only on testnet. The vault constructor must allow `sequencerFeed = address(0)` on mainnet too, until Chainlink publishes one.
3. **Stock feeds update on price deviation, not continuously.** On a normal Tuesday the TSLA feed printed 13 times, then went quiet for 7h+ overnight. Last weekend (18–21 Sep): TSLA's last Friday print was 19:48 UTC and NVDA's was 19:55 UTC. Both printed at **Mon 00:00 UTC** and again ~01:10. So:
   - `maxPreCloseAge = 6h` passes when the last Friday print is after 18:00 UTC. It can fail for a quiet ticker, and the epoch is then skipped (safe, but it lowers utilisation). The keeper should log the reason.
   - Settle freshness `updatedAt >= windowEnd` was satisfiable at Mon 00:00 last week.
4. **Testnet TSLA candidate `0xC9f9…3Bd4E` does not implement `oraclePaused()`** (reverts), so `_readFeed` would revert against it. The testnet demo uses `MockStockToken`.
5. **Testnet USDG candidate `0x0000…F34f` ("USD Gold (testnet)") has 18 decimals, not 6.** It's unconfirmed as the faucet token. The demo uses `MockUSDG` (6 dec). Code reads `decimals()` everywhere, so either would work.
6. **SPEC §5.1 names `FixedPointMathLib.sqrt`** (solmate/solady), which is not an approved dependency. We use OpenZeppelin `Math.sqrt` with explicit rounding.
7. **SPEC §6.2 conflict:** OPEN_MIXED "returns to OPEN when … anyone calls `retryBuyback` later", but `retryBuyback` is "within retryWindow" and OPEN_MIXED only starts *after* retryWindow. Resolution: `retryBuyback` stays callable in OPEN_MIXED (fresh-oracle rules and cap still apply).
8. **CLAUDE.md vs SPEC on fees:** CLAUDE.md says owner/keeper can *never* receive vault funds. SPEC §6.3 allows the performance fee to `feeRecipient`. SPEC wins. To keep the invariant meaningful, `feeRecipient` is set at construction and is **immutable**, and fees are paid only from positive PnL.
9. **CLAUDE.md said `docs/SPEC.md`,** but SPEC.md was at the repo root. It has been moved to `docs/SPEC.md`.

## Still UNVERIFIED

- Testnet faucet STOCK and USDG addresses (need a faucet claim tx).
- StateView / Quoter addresses on Robinhood mainnet. Offchain reads use `extsload` (works).
- Robinhood testnet settlement-layer migration (Sepolia retirement notice).
- Stock Token jurisdiction list (needed before any mainnet deposit).
