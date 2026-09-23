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
| M5 | Web `/vault` `/backtest` `/paper`, testnet deploy, DemoBuyer | ⏳ |
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
```

## License

MIT
