# Offmint — Arbitrum Open House Singapore submission

Deadline: **Sun 4 Oct 2026, 07:59 UTC**. Every number below is in `docs/CLAIMS.md` with its source file and status
(verified onchain / simulated / live). Categories: the Robinhood Chain slot, and **Promising Products** as a novel
financial primitive. The keeper is a rules-based bot, not an AI.

## One line
**They price the weekend. We supply it.** Session-gated liquidity for Robinhood Chain stock tokens: supply that
exists only while minting is off, placed only above the reference price, with a capped buyback on Monday.

## Links
| | |
|---|---|
| Site | PUBLIC URL (added at D1, Cloudflare) |
| Repo | https://github.com/offmint/offmint |
| Contracts (testnet 46630, source-verified) | https://explorer.testnet.chain.robinhood.com/address/0x2ea8dF9feA9DDEBb0abf774aE46E1DFF9a6E4285 (community vault); full table in README |
| Live paper mode (mainnet, read-only) | https://offmint-keeper-production.up.railway.app/paper/index.json |
| Video (3 min) | VIDEO URL (user records Sat 3 Oct) |

## The problem
Robinhood stock tokens trade 24/7, but new tokens can only be created while the real market is open. Minting is off
for **31.2% of 2026** (2,736 of 8,760 hours: every weekend and US market holiday). With no new supply, a token can
trade far above the real share:
- **HIMS +317.6%** above its Friday reference on the weekend of 29 Aug 2026; **GLXY +186.1%** on 12 Sep. Both were new
  listings without a Chainlink feed. A feed doesn't make a token immune: in 12 windows, a premium above 10% held for an
  hour or more 19 times, 16 on tokens without a feed (LMT +53.5% on 5 Sep) and 3 on tokens with one (MSTR, including
  +243.3% the same weekend as HIMS, and RKLB). The largest names (NVDA, TSLA, AAPL, SPY) stayed within 2.6%.
- Across 12 mint-off windows since 1 Jul, buyers paid **$3,615,154 above the reference price** on **$17,594,088** of
  buys priced more than 5% above it, from **23,291 wallets** (every onchain swap vs the official close; bots and
  aggregators included).
- It recurs across the basket, not per ticker: a premium above 10% held for an hour or more in **4 of 11** windows, on
  only 3.6% of token-weekends. That's why Offmint works from a live basket (a detector rebuilt every 6 hours), not a
  fixed list.

## What we built: four features, one story
**See it → learn from history → act yourself → or let the vault do it.**
1. **Monitor** (`/monitor`): every token's pool price vs Robinhood's real price, live. A premium counts as verified only
   if it passes five quality checks; the rest are shown with the reason.
2. **Weekend report** (`/weekends`): every mint-off window since 1 Jul, per token, with a share card. Updated every
   Monday from paper mode.
3. **Personal sell order** (`/sell`, testnet): a sell-only Uniswap v4 order from your own wallet, priced above the
   verified reference, never the pool. Uniswap's PositionManager + Permit2; no Offmint contract touches your tokens.
   Run live through the UI: placed, filled 100%, collected (docs/verification/sellorder-live.md).
4. **Community vault** (`/vault/HIMS`, testnet): deposit tokens you already hold. When minting closes, the vault posts four
   one-sided range orders above Friday's price (+8–12%, +15–22%, +25–35%, +40–55%). On Monday it buys back, never above
   the fresh price + 1%. Run live through the UI (deposit, arm, squeeze, settle, withdraw): **159.604 mHIMS back for the 150 deposited** (+6.40% after the
   fee; simulated squeeze on testnet) (docs/verification/vault-live.md).

Plus `/sandbox`: one weekend step by step in the browser, using the same engine as the replay, no wallet needed.

## What it would have earned — and what it can lose
Per $1,000 of tokens deposited, **simulated** on real weekend swaps with our own orders added to each pool (excluding LP
fee income, after the 10% fee on profit):
| | |
|---|---|
| Big spike weekend | +3.8% (HIMS, 29 Aug) to +7.1% (GLXY, 12 Sep) |
| Normal weekend | about 0%: nothing sells on 191 of 198 ticker-weekends |
| Worst replayed weekend | −0.1% (NU, 12 Sep), mostly gas |
| Monday buyback capacity | about $1,647 per pool (median; range $0 to $5,198) |

If the real stock opens higher on Monday, the capped buyback can't get every sold token back, so a depositor can end with
fewer tokens (the stress test saw −0.49% on one weekend). Unaudited, testnet only.

## Judging criteria → evidence
| Criterion | Evidence |
|---|---|
| **Smart contract quality** | 160 forge tests (unit, fuzz, both pool orientations, invariants), 12 mainnet-fork tests pinned at block 71,241,990, 102 keeper + backtest tests, all in CI. Stress: 40 random weekends × 12 depositors, 0 invariant violations. Slither triaged (docs/verification/slither.md). Threat model per key and per input, including the sell order (docs/THREAT_MODEL.md). Owner and keeper can never receive funds; every sell step starts ≥ Friday's price × (1 + premium); buyback capped; anyone can arm or settle if the keeper stops. Contracts talk to the v4 PoolManager directly (`unlock` + callback). All testnet contracts source-verified. |
| **Real problem** | HIMS +317.6%, GLXY +186.1%; $3,615,154 paid above the reference by 23,291 wallets in 12 windows; minting off 31.2% of the year; Robinhood's own docs on the tokenization window. In a Bankless interview ([reported by BigGo Finance](https://finance.biggo.com/news/4691062f7e0b2bb5), 21 Sep 2026), Robinhood's Johann Kerbrat named market-maker depth as the main fix and said Uniswap pools where users lend stock tokens are part of the liquidity; Robinhood's [launch announcement](https://robinhood.com/us/en/newsroom/robinhood-accelerates-global-expansion-robinhood-chain-mainnet-stock-tokens-agentic-trading/) (1 Jul 2026) lists deploying Stock Tokens into lending pools. |
| **Innovation** | Liquidity that follows the tokenization clock: it exists only while minting is off. A detector that finds new listings without a Chainlink feed, and a Robinhood-API price reference for them (separate poster key, 20% per-post cap). Sell orders anchored to the verified reference, refused when the pool is already there. Community and MetaVault money kept in separate vault instances. |
| **Product-market fit** | Clear first user: holders of newly listed tokens, who add no new exposure. Recurrence is basket-wide (4 of 11 windows). Fees: 10% of profit, no fee on a flat weekend; the sell order is free. Honest size: about $1,647 per pool today, raised by RFQ/aggregator buybacks (roadmap). Aggregators route weekend buyers to the best price, so our orders fill without our own frontend. |

## Honest limits
- Small sample: two big squeezes in the weekends measured.
- Thin pools, small capacity; at today's size it does not calm the spike.
- Our supply shrinks the spike it sells into (CRWV 29 Aug: +26% → +9% with our orders).
- MetaVault (deposit dollars instead of tokens) is experimental: its picker, replayed point-in-time, did not pick HIMS.
- Unaudited. Testnet only. Not available to US persons.

## Roadmap
Testnet (now) → audit → capped mainnet → RFQ/aggregator buybacks → launchpad pool supply → other tokenized-stock issuers
→ onchain canonical-token check in the factory.

## Team and disclosure
Offmint is an independent project, not affiliated with or endorsed by Robinhood or the Arbitrum Foundation.
