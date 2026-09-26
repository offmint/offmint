# Offmint — decisions log

Decisions made by the user, newest first. Where a decision here conflicts with WINPLAN.md, FEATURES.md, TAILOR.md,
BITGET.md or AIRTIGHT.md, **this file wins**. Each entry: what was decided, why, and what it changes.

## 26 Sep 2026

### D8. Token icons: Robinhood's own image only
- The icon next to a ticker is Robinhood's token image from `https://api.robinhood.com/rhj/assets` (`logoUrl`), shown
  next to the ticker badge (ASSETS.md §2). No third-party company logos (they matched by ticker and showed the wrong
  company). If the image fails to load, the ticker badge alone is shown.

### D7. Sandbox: in-browser simulation, fully explained
- `/sandbox` runs one weekend in the browser on the same engine as the published replay (keeper/src/poolSim.ts +
  supplyReplay.ts): the market is illustrative, the vault's rules are real. Six explained steps, three presets
  (normal / big spike / Monday opens higher), glossary, honesty box.
- Why not onchain-instant: `settleDelay >= 30 min` is a hard bound and the epoch stores `windowEnd` at arm, so a full
  onchain cycle takes >= ~31 min without a contract change. The onchain sandbox stack is deployed
  (`contracts/deployments/sandbox-46630.json`) for real testnet transactions; the page states which parts are onchain.

## 25 Sep 2026

### D6. Harm numbers: "paid above the reference price", headline at 5%
- Never write "overpaid". The paid price includes the pool fee (≤ 1%), and a buyer whose stock opened higher after the
  window may have lost nothing. Wording everywhere: **"paid above the reference price"**.
- Headline threshold **5%** above the reference (well beyond fee + normal spread). 2% and 10% are shown as detail.
- Changes: `backtest/src/harm.ts` (thresholds 0/2/5/10, headline 5), replay field renamed to
  `buyersPaidAboveReferenceUsd`.

### D5. Personal sell order is priced from the verified reference, not the pool
- The level is reference × (1 + premium). In a weekend spike the pool is already inflated, so a pool-anchored "+10%"
  would sit at the wrong level. If the pool already trades at or above the level, the order is **refused** (not shifted
  up). Minimum +5%.
- Changes: `keeper/src/sellOrder.ts` + tests (both orientations, pool above reference), gate re-run with case B
  (`docs/verification/sellorder-gate.md`).

### D4. Personal sell order: build on Uniswap's PositionManager + Permit2 (Step 0 gate passed)
- Testnet 46630: PositionManager `0x58daec3116aae6D93017bAAea7749052E8a04fA7` (bound to our PoolManager
  `0x8366a39C…43e40951`), Permit2 `0x000000000022D473030F116dDEE9F6B43aC78BA3` (canonical). 13 other contracts named
  PositionManager on testnet are bound elsewhere or revert: never use them.
- **No new contract** for the sell order. Any new contract needs explicit user approval first.
- Evidence: `docs/verification/sellorder-gate.md`, `keeper/src/sellOrderGate.ts` (local anvil fork only).

### D3. Product = four features (FEATURES.md amends WINPLAN's schedule)
- **Monitor → Weekend report (`/weekends`) → Personal sell order (`/sell`, testnet) → Vault.**
- Dropped for Singapore: SELECT point-in-time validation (AIRTIGHT 9) and the MetaVault testnet redeploy (AIRTIGHT 12).
  MetaVault code and tests stay as they are.
- If behind on **Wed 30 Sep**: cut the personal sell order, keep the weekend report. Never cut the foundation,
  sandbox or landing hero.

### D2. Pitch: the community vault only; MetaVault is one line
- Pitch = connect → deposit your stock tokens → withdraw with extra after a spike weekend.
- A plain-English explanation sits at the **top of the README and the landing page**, with the real numbers read from
  `web/public/data/supply/replay.json` (with-supply replay): what a big spike weekend earned, what a normal weekend
  earns (~0), what a bad weekend costs, the 10% fee on profit, and buyback capacity per pool today.
- MetaVault, wherever it appears, is exactly: **experimental, coming later** — and says why: its weekly picker, replayed
  with only the data it would have had, **did not pick HIMS before the 29 Aug spike** (`docs/verification/select.md`).
- Never claim Offmint calms or prevents spikes: the with-supply replay shows it barely lowers the peak at today's sizes.
- Why: the with-supply replay gave modest per-weekend returns and a hard capacity limit (Monday buyback depth); the
  simple, honest pitch is stronger.

### D1. Bitget: Alpha Factory → Open Theme (not Arbitrage)
- Framed around **market impact and capacity**: what a supplier earns from mint-off premiums once its own orders move
  the price, and how that shrinks with size (with-supply replay at $1k / $10k / $100k).
- Supersedes BITGET.md's "sub-theme Arbitrage" and WINPLAN item 24. Everything else in BITGET.md (periods, metrics,
  disclosure, deliverables under `bitget/`) still applies.

### D0. Entries
- Two entries only: Arbitrum Open House Singapore (Sun 4 Oct, 07:59 UTC) and Bitget AI Base Camp S2 (8 Oct, UTC+8).
  No Colosseum, no Unichain.
- 25 Sep: redundant docs removed at the user's request (curation*.md, weekday-vs-weekend.md, window.md,
  price-reference.md, FACTS.md); all were regenerable outputs or superseded drafts.
