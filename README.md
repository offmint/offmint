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
| M0.5 | Ticker curation (SPEC §3.5): registry-wide screen + 8-weekend backtest | ✅ ran; **result: 0 shippable tickers**, see `docs/curation.md` (decision pending) |
| M1 | Keeper paper mode (read-only mainnet) + `/monitor` | 🚧 paper/replay engine done; `/monitor` pending |
| M2 | `SessionClock`, `ManualSessionClock`, `RangeMath` + unit/fuzz tests | ✅ done |
| M3 | `OffmintVault` + unlock-callback flows + integration + invariant tests | ✅ done: 4-rung ladder (§5.0), per-rung `lock()`, pluggable `IPriceReference` (Chainlink / push with owner freeze); 126 tests, E2E +6.41 STOCK / 100 |
| M3.5 | `MetaVault` + `VaultFactory` + keeper SELECT (§6.5) | ✅ contracts + acceptance tests (28, incl. `restrictedDepositor` isolation); keeper SELECT scoring + MetaVault cycle in the bot (local E2E: buy-in → commit → arm → settle → unwind, IDLE again) |
| M4 | Mainnet fork test + backtest JSON | ✅ fork green on TSLA (S0) + HIMS (S1); HIMS backtest +14.7% STOCK vs HODL ex-fees |
| M5 | Web `/vault` `/backtest` `/paper`, testnet deploy, DemoBuyer | 🚧 backend done: Deploy + DemoBuyer scripts, keeper bot, local E2E green (+8.45 STOCK / 100); **testnet deployed + verified; live demo weekend completed: +8.45 mHIMS / 100** (arm → lock → settle by the keeper bot); web pending |
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

Redeployed 24 Sep 2026 with the laddered vault, `restrictedDepositor` isolation, VaultFactory and MetaVault: 30/30
transactions succeeded and all 14 contracts are source-verified on the explorer. Pool: hook-free mHIMS/USDG, fee 0.30%,
tick spacing 60, initialised at $28.84 (stock = currency0). The community vault is OPEN with a 100 mHIMS demo deposit.
MetaVault is IDLE with 9,950.25 USDG (a 10,000 deposit minus the 0.5% entry fee). The first deployment (single-range vault,
`0xc3413BCc…50bdA`, live demo weekend +8.45 mHIMS / 100) remains onchain; its record is in git history.

| Contract | Address |
|---|---|
| MetaVault (omMETA, USDG in) | [`0xDE1D914e7eC0cAd677137aBa80582c7129F61AAC`](https://explorer.testnet.chain.robinhood.com/address/0xDE1D914e7eC0cAd677137aBa80582c7129F61AAC) |
| VaultFactory | [`0x93EeffA175076F01184Fd467CA9ca4d48Ca2A2E1`](https://explorer.testnet.chain.robinhood.com/address/0x93EeffA175076F01184Fd467CA9ca4d48Ca2A2E1) |
| OffmintVault, community instance (obmHIMS, open) | [`0x2ea8dF9feA9DDEBb0abf774aE46E1DFF9a6E4285`](https://explorer.testnet.chain.robinhood.com/address/0x2ea8dF9feA9DDEBb0abf774aE46E1DFF9a6E4285) |
| OffmintVault, MetaVault-exclusive instance (mbmHIMS) | [`0x4DF1d410aa932BF5B22E0E2d4dB8d71c1102193E`](https://explorer.testnet.chain.robinhood.com/address/0x4DF1d410aa932BF5B22E0E2d4dB8d71c1102193E) |
| ChainlinkPriceReference (shared by both instances) | [`0x9B2eB67C72E32Fd0fb06F6130005CC0734271b61`](https://explorer.testnet.chain.robinhood.com/address/0x9B2eB67C72E32Fd0fb06F6130005CC0734271b61) |
| Mock HIMS (mHIMS) | [`0x048A615495D189992bf03Ca54767be60754bD1bE`](https://explorer.testnet.chain.robinhood.com/address/0x048A615495D189992bf03Ca54767be60754bD1bE) |
| Mock USDG (6 dec) | [`0x0844463B36f999C84641aE0cd0fFF27179C4DBBb`](https://explorer.testnet.chain.robinhood.com/address/0x0844463B36f999C84641aE0cd0fFF27179C4DBBb) |
| MockFeed | [`0xd80327b5F068FD071a3401c6c1e4409CaCCC8e65`](https://explorer.testnet.chain.robinhood.com/address/0xd80327b5F068FD071a3401c6c1e4409CaCCC8e65) |
| ManualSessionClock | [`0xa4C76ac760F3e616FB98924e031aFbabbe1AB0f8`](https://explorer.testnet.chain.robinhood.com/address/0xa4C76ac760F3e616FB98924e031aFbabbe1AB0f8) |
| v4 PoolManager (chain's own) | [`0x8366a39CC670B4001A1121B8F6A443A643e40951`](https://explorer.testnet.chain.robinhood.com/address/0x8366a39CC670B4001A1121B8F6A443A643e40951) |
| PoolSwapTest (demo buyer) | [`0xA6c9CC615b599659c654a36A9C0B12815ED5E542`](https://explorer.testnet.chain.robinhood.com/address/0xA6c9CC615b599659c654a36A9C0B12815ED5E542) |
| PoolModifyLiquidityTest (seed LP) | [`0xf3C288f568503bB1184bb9dC61E3DE9eb333A1EE`](https://explorer.testnet.chain.robinhood.com/address/0xf3C288f568503bB1184bb9dC61E3DE9eb333A1EE) |
| OffmintParams (linked library) | [`0xb1a77579a5c23c4b29b9539b572cb8ca855aee0b`](https://explorer.testnet.chain.robinhood.com/address/0xb1a77579a5c23c4b29b9539b572cb8ca855aee0b) |
| VaultPoolOps (linked library) | [`0xdb193f8c2021b974294ef9fb84150e01fa796cc5`](https://explorer.testnet.chain.robinhood.com/address/0xdb193f8c2021b974294ef9fb84150e01fa796cc5) |
| RangeMath (linked library) | [`0x4d49582dee11bcecdc73430f7d6938ebbf88913f`](https://explorer.testnet.chain.robinhood.com/address/0x4d49582dee11bcecdc73430f7d6938ebbf88913f) |

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

## Paper mode service (Railway)

The service runs keeper paper mode around the clock: a read-only, deterministic simulation on mainnet, with no keys. It uses the
curated tickers (`contracts/config/tickers.json`) plus major controls, and records what the vault would have done every weekend.
`keeper/Dockerfile` + `keeper/railway.json`. On Railway, leave Root Directory as `/` (the service also reads
`contracts/config/`), set **Config File Path** = `/keeper/railway.json`, and mount a volume at `/data`. Its watch paths are
`keeper/**`, `contracts/config/**` and the root lockfile, so pushes that only touch `web/` don't redeploy it. Endpoints:
`/health` (last tick, restarts), `/paper/index.json`, `/paper/<date>-<TICKER>.json`. Run it locally with `npm run service -w keeper`,
or in tmux with `scripts/paper-run.sh`.

## Demo (testnet)

**Completed live on 23 Sep 2026** (`contracts/deployments/demo-46630.json`). The keeper bot armed
([`0x0ba5…549e`](https://explorer.testnet.chain.robinhood.com/tx/0x0ba528efee4a85c8c02bf68ae7be5f7798328e9b62437d233db1ec616149549e)),
locked when the band was cleared ([`0x7893…d268`](https://explorer.testnet.chain.robinhood.com/tx/0x7893e661e74fd038331203ee7c477168e0159648652f00b8e380489688d268bd))
and settled ([`0xc862…6841`](https://explorer.testnet.chain.robinhood.com/tx/0xc86205ad0410819a4d5c290c8ce58b25f9290b2ddcd7404252383d0da3c06841)).
The vault sold 30 mHIMS for 1,151.04 USDG and bought back 39.39, for +9.39 mHIMS gross and **+8.45 per 100 deposited after
the 10% fee**. `scripts/demo-testnet.sh` reruns it and is resumable.

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
