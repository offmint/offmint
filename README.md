# Offmint

> **They price the weekend. We supply it.**

Offmint is an epoch vault for Robinhood Chain stock tokens. Stock-token minting closes over the weekend, and scarcity
premiums appear (tokenized HIMS printed ~$61 against a $28.84 close on 28–31 Aug 2026). Offmint posts a one-sided
Uniswap v4 range order of depositors' stock above the last Chainlink price. It sells into those premiums, then buys
the stock back after reopen. Depositors end the weekend with more stock per share.

⚠️ Unaudited hackathon software. A Monday gap-up above the band is the covered-call trade-off. Buybacks are capped at feed + slippage.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold, on-chain fact checks (`docs/FACTS.md`, `contracts/config/*.json`) | ✅ done |
| M1 | Keeper paper mode (read-only mainnet) + `/monitor` | 🚧 paper/replay engine done; `/monitor` pending |
| M2 | `SessionClock`, `ManualSessionClock`, `RangeMath` + unit/fuzz tests | ✅ done |
| M3 | `OffmintVault` + unlock-callback flows + integration + invariant tests | ✅ done (incl. approved `lock()`) |
| M4 | Mainnet fork test + backtest JSON | ✅ fork green on TSLA (S0) + HIMS (S1); HIMS backtest +14.7% STOCK vs HODL ex-fees |
| M5 | Web `/vault` `/backtest` `/paper`, testnet deploy, DemoBuyer | 🚧 backend done: Deploy + DemoBuyer scripts, keeper bot, local E2E green (+8.45 STOCK / 100); **testnet deployed + verified**; demo weekend next; web pending |
| M6 | README, diagram, video, deck | ⏳ |

## Backtest: HIMS, 28–31 Aug 2026

Real Uniswap v4 swaps (8,306) on the deepest hook-free HIMS/USDG pool. P0 = $28.84 (NYSE close); band $31.76–$45.93.
The pool peaked at $124.70 on Sunday night and was back at $32.53 when settle opens (Mon 01:00 UTC).

| Variant (100 HIMS deployed) | Avg sell | STOCK vs HODL, ex-fees |
|---|---|---|
| Hold until settle (spec as first written) | — | −0.15% (the range order bought everything back on the way down) |
| **`lock()` when the band is cleared** | $41.12 | **+14.7%** |
| `lock()` at Mon 00:00 − 15 min | $51.24 | +14.7% |

A live vault would have dampened the spike, so real fills would differ. LP-fee estimates are reported separately in the JSON.

## Deployed: Robinhood Chain testnet (46630)

All contracts are source-verified on the explorer. Pool: hook-free mHIMS/USDG, fee 0.30%, tick spacing 60, initialised at
$28.84 (stock = currency0). The vault is OPEN with a 100 mHIMS demo deposit.

| Contract | Address |
|---|---|
| OffmintVault (omHIMS) | [`0xc3413BCcc6BAf64430FF0f0f56B9C2B1D9850bdA`](https://explorer.testnet.chain.robinhood.com/address/0xc3413BCcc6BAf64430FF0f0f56B9C2B1D9850bdA) |
| Mock HIMS (mHIMS) | [`0x615f0560B449599e8f4825B76B495713f0fbC67B`](https://explorer.testnet.chain.robinhood.com/address/0x615f0560B449599e8f4825B76B495713f0fbC67B) |
| Mock USDG (6 dec) | [`0x9ADB65C487dCC0B6D61b4110B45c07098f7A4006`](https://explorer.testnet.chain.robinhood.com/address/0x9ADB65C487dCC0B6D61b4110B45c07098f7A4006) |
| MockFeed | [`0xB1427c1699306e612868EBCc92A2Ec3Ff9d414f6`](https://explorer.testnet.chain.robinhood.com/address/0xB1427c1699306e612868EBCc92A2Ec3Ff9d414f6) |
| ManualSessionClock | [`0x2dc88AdB3D66Dc754F97CAE59Cb3a01E97eA109d`](https://explorer.testnet.chain.robinhood.com/address/0x2dc88AdB3D66Dc754F97CAE59Cb3a01E97eA109d) |
| v4 PoolManager (chain's own) | [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://explorer.testnet.chain.robinhood.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |
| PoolSwapTest (demo buyer) | [`0xb0C6BE3C382e93a4d83Ae4648A91BcE3907B0edA`](https://explorer.testnet.chain.robinhood.com/address/0xb0C6BE3C382e93a4d83Ae4648A91BcE3907B0edA) |
| PoolModifyLiquidityTest (seed LP) | [`0x6fA6b29869e5044A091E115B5Cb9f2dF737FE53e`](https://explorer.testnet.chain.robinhood.com/address/0x6fA6b29869e5044A091E115B5Cb9f2dF737FE53e) |
| RangeMath (linked library) | [`0x20f2776d12dc69daabe0b61f731aae53b3a39d3a`](https://explorer.testnet.chain.robinhood.com/address/0x20f2776d12dc69daabe0b61f731aae53b3a39d3a) |

## Stress test (local chain, time-warped)

`npm run stress -- --epochs 40 --users 12 --seed 7` runs the real `Deploy.s.sol` and the unmodified keeper bot through
40 random weekends in about 67 s: squeezes, partial fills, quiet weekends, Monday gap-ups past the
buyback cap, and oracles that never come back. There are 12 depositors, making 160 deposits and 69 redemptions between epochs.
After every step it checks that owner and keeper balances never change, that the vault holds no USDG when OPEN,
that deposits and withdrawals are gated outside OPEN, and that share supply is frozen while ARMED or PENDING.
**Violations: 0.** The full report is in `docs/stress/stress-report.json`; CI runs a 10-epoch version.

| Keeper action | Calls | Avg gas |
|---|---|---|
| `arm` | 40 | 446,903 |
| `lock` | 24 | 184,561 |
| `settle` | 38 | 230,877 |
| `retryBuyback` | 78 | 179,302 |
| `emergencyUnwind` | 2 | 75,700 |

Scenario outcomes are synthetic, chosen to exercise every code path. Use the backtest for return expectations, not these.

## Demo (testnet)

`contracts/script/Deploy.s.sol` deploys mock HIMS, 6-decimal mock USDG, a MockFeed and a ManualSessionClock. It creates a
hook-free pool on the chain's own v4 PoolManager and deploys the vault. `contracts/script/DemoBuyer.s.sol` plays the
market (`fridayClose`, `openWeekend`, `pump`, `mondayPrint`), and the keeper bot does the rest. Demo timing uses the
lowest values the hard bounds allow, so one weekend takes about 75 minutes (40-minute window + 30-minute `settleDelay`).

## Contracts

| Contract | Role |
|---|---|
| `OffmintVault` | ERC-4626 vault per stock. `arm` → (`lock`) → `settle` / `retryBuyback` / `emergencyUnwind` / `expireBuyback` / `redeemMixed`. Talks to the v4 PoolManager directly via `unlock` + `unlockCallback`. |
| `SessionClock` | Weekend window Sat 00:00 → Mon 00:00 UTC, with an owner-set offset bounded to ±3h. |
| `ManualSessionClock` | Testnet demo only: the owner opens and closes the window. |
| `RangeMath` | USD ↔ sqrtPrice in both pool orientations; one-sided premium range; buyback cap. |

Safety properties tested: the owner and keeper never receive funds; the range lower bound is ≥ P0·(1+premium); no arm or settle on a paused, stale or sequencer-down oracle; share supply is frozen while ARMED or PENDING; the buyback never pays more than feed·(1+slippage) plus the LP fee; anyone can arm or settle after the grace period; first-depositor inflation is unprofitable (decimals offset 3).

## Repo layout

```
contracts/  Foundry project (src/ test/ script/ config/)
keeper/     arm/settle bot + paper mode (TypeScript + viem)
web/        Next.js app: /monitor /vault /backtest /paper
backtest/   HIMS 28–31 Aug replay -> web/public/backtest/*.json
scripts/    fact-check / discovery helpers
docs/       FACTS.md, CHANGELOG.md
```

## Run

Monorepo: Foundry contracts in `contracts/`, npm workspaces for the TypeScript packages.

```bash
npm install && npm test                          # 101 forge tests (unit, fuzz, integration x2 orientations, invariants) + 28 keeper tests
cd contracts && forge build && forge test -vvv
python3 scripts/discover_pools.py TSLA NVDA     # refresh contracts/config/mainnet.json
cd keeper && npm i && npm test
npm run paper                                    # live paper mode (read-only mainnet, no key)
npm run replay -- 2026-08-29 --tickers HIMS      # replay a past weekend -> web/public/paper/replay/
npm run backtest -- --event hims-2026-08-28      # SPEC §10 backtest -> web/public/backtest/hims-2026-08-28.json
npm run test:fork                                # mainnet fork tests (real PoolManager / TSLA / HIMS / USDG)
npm run lint:contracts                           # forge fmt --check + forge lint (CI-enforced)
npm run e2e                                      # fresh anvil: deploy -> keeper bot arms, locks, settles -> assert gain
npm run abi                                      # regenerate keeper/src/abi from forge artifacts (CI checks drift)

# keeper bot against a deployment (testnet after the deploy is approved)
RPC_URL=$RH_TESTNET_RPC KEEPER_PRIVATE_KEY=0x... npm run bot -w keeper -- --deployment ../contracts/deployments/46630.json
```

## License

MIT
