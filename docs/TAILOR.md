# Offmint — tailoring for the two hackathons it can win

**Decision:** Offmint is submitted to **two** hackathons only. It is **not** submitted to Colosseum
(Colosseum judges traction/users, which Offmint can't show in time). Ignore Colosseum tasks in NEXT.md.

| Hackathon | Deadline | Entry | How it's judged |
|---|---|---|---|
| Arbitrum Open House Singapore | **Sun 4 Oct, 07:59 UTC** | Offmint (Robinhood Chain) | Smart contract quality · product-market fit · innovation · real problem |
| Bitget AI Base Camp S2 | **8 Oct (UTC+8)** — user to confirm exact hour on the form | Offmint strategy → Alpha Factory → Arbitrage (+ University Name) | Purely quantitative: Sharpe, Sortino, drawdown, turnover, OOS decay |

Everything below serves one or both. Shared work first, because both entries depend on it.

---

## Phase 1 — shared foundation (do first, both entries need it)
1. **Backtest engine fix** — AIRTIGHT item 2 (MSTR +243% / −100%). Blocker for every number.
2. **"With our own supply" replay** — AIRTIGHT item 7. Headline numbers for both entries use it.
3. **Harm scan (new).** Across every weekend and holiday since 1 Jul, every stock token: count swaps and unique
   wallets that bought above the reference price during the mint-off window, and total USD paid above reference.
   Output `web/public/data/harm.json` + a short method note. This is Singapore's "real problem" and PMF evidence,
   and needs no users or outreach. Report exactly what the data says, including if it's small.
4. **Premium frequency.** From the Bitget sensitivity grid: how often do weekend premiums exceed 2%, 5%, 10%,
   25%? Output `web/public/data/frequency.json`. If small premiums are common, it supports a lower first rung;
   if not, say so.
5. **Mint-off window size.** Compute hours per year minting is off (weekends + US market holidays, per the Robinhood
   sources in AIRTIGHT item 3), and the share of the calendar. Show the arithmetic on the site.

## Phase 2 — Singapore package (by 3 Oct)
**Positioning:** Offmint is a **new financial primitive for Robinhood Chain: session-gated liquidity** — supply that
exists only while minting is off, placed only above the reference price, with a capped buyback. It targets the
problem Robinhood's own crypto GM named: weekend scarcity premiums, fixed by market-maker depth.

**Lead with the community vault.** It is market-neutral for holders (they already held the token) and is the
cleanest demonstration of the primitive. MetaVault is shown as the second product, labelled **experimental**, with
its risk stated, and with the SELECT validation result (AIRTIGHT item 9) reported honestly.

**Map every judging criterion to evidence on the site and in the submission:**
| Criterion | Evidence |
|---|---|
| Smart contract quality | test count, invariant/stress results, Slither report, THREAT_MODEL.md, verified contracts, isolation of vaults, sandbox anyone can run |
| Real problem | HIMS/GLXY spikes, **harm scan** ($ overpaid, wallets affected), mint-off window size, Robinhood sources |
| Innovation | first liquidity that follows the tokenization clock; detector + Robinhood-API price reference for tokens without Chainlink feeds; vault isolation |
| Product-market fit | sponsor alignment (GM's statement), recurrence data (frequency), with-supply returns, clear target user (holders of new listings), fee model (0.5% tx on MetaVault, 10% of profit), routing: aggregators send weekend flow to the best price → our liquidity |

**Categories to target in the submission text:** the Robinhood-reserved podium slot, and **Promising Products** as a
*novel financial primitive* (not as an AI agent — the keeper is rules-based; say so).

**Include a roadmap** (winners were praised for clear roadmaps): testnet (now) → audit → capped mainnet → integrate
supply into launchpad/stock-paired pools → other tokenized-stock issuers with the same mint window → onchain
canonical-token check in the factory (ASSETS.md §6).

**Deliverables:** landing (LANDING_BRIEF.md) · sandbox (instant, compressed time) · README · 3-min video script ·
`docs/submission/HACKQUEST.md` rewritten around the table above · QA.md.

**Cut or tone down for Singapore:** yield/APY language, "AI", MetaVault return claims, anything unverified
(AIRTIGHT rules).

## Phase 3 — Bitget package (by 7 Oct)
Follow `docs/BITGET.md` exactly, with these updates:
- Deadline is now **8 Oct (UTC+8)**. Use the extra days to add the **Sep 26–28 and Oct 3–5 weekends** to the
  backtest/paper record (parameters frozen before them — label these as genuinely out-of-sample live observations).
- Headline metrics use the with-supply replay.
- Strategy = the community-vault overlay (excess return over holding). No MetaVault directional returns.
- In the description, the thesis leads with: mint/redeem is the arbitrage that keeps tokens at NAV; it switches
  off every weekend and holiday; Offmint supplies exactly then.

## Order
Phase 1 (items 1–2 first, then 3–5) → Phase 2 → Singapore submit (user, before Sun 4 Oct 07:59 UTC) → Phase 3 →
Bitget submit (user, by 8 Oct).

## Report back after each phase
What shipped, the numbers produced (harm scan totals, frequency table, with-supply returns), anything that came out
weaker than expected, and what changed on the site.
