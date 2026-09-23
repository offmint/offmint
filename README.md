# Offbell

> **They price the weekend. We supply it.**

Offbell is an epoch vault for Robinhood Chain stock tokens. Stock-token minting closes over the weekend, and scarcity
premiums appear (tokenized HIMS printed ~$61 against a $28.84 close on 28–31 Aug 2026). Offbell posts a one-sided
Uniswap v4 range order of depositors' stock above the last Chainlink price. It sells into those premiums, then buys
the stock back after reopen. Depositors end the weekend with more stock per share.

⚠️ Unaudited hackathon software. A Monday gap-up above the band is the covered-call trade-off. Buybacks are capped at feed + slippage.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold, on-chain fact checks (`docs/FACTS.md`, `contracts/config/*.json`) | ✅ done |
| M1 | Keeper paper mode (read-only mainnet) + `/monitor` | 🚧 in progress |
| M2 | `SessionClock`, `ManualSessionClock`, `RangeMath` + unit/fuzz tests | ✅ done (21 tests) |
| M3 | `OffbellVault` + unlock-callback flows + integration tests | ⏳ |
| M4 | Mainnet fork test + backtest JSON | ⏳ |
| M5 | Web `/vault` `/backtest` `/paper`, testnet deploy, DemoBuyer | ⏳ |
| M6 | README, diagram, video, deck | ⏳ |

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

```bash
cd contracts && forge build && forge test -vvv
python3 scripts/discover_pools.py TSLA NVDA     # refresh contracts/config/mainnet.json
```

## License

MIT
