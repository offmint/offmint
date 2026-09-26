# Offmint — FEATURES: weekend report + personal sell order

Product = four features, one story: **see it (Monitor) → learn from history (Weekend report) → act yourself
(Personal sell order) or let the vault do it (Vault).** This file amends WINPLAN.md's schedule; everything else in
WINPLAN still applies (rules, judge path, freeze, approvals).

## Cuts (to make room)
MetaVault is "experimental, coming later" in the pitch, so for Singapore **drop**: SELECT point-in-time validation
(AIRTIGHT 9) and the MetaVault testnet redeploy (AIRTIGHT 12). Keep MetaVault code and tests as they are; one line on
the site says it's experimental. Revisit both only for Bitget if time allows.

---

## Feature 2 — Weekend report (`/weekends`)
**Data:** harm scan + with-supply replay + mint-off windows (all Phase 1 outputs) + paper-mode logs going forward.
**Page:** one row per mint-off window (weekend or US holiday), newest first. Columns: dates, number of tokens above
10%, biggest premium (token + %), USD paid above the reference price, wallets affected.
**Detail view** (`/weekends/[date]`): per token — peak premium, hours above 10%, USD paid above reference, wallets,
hours until back within 5% of the reference after reopen, and what the community vault would have earned
(with-supply replay, labelled simulated).
**Auto-update:** after each Monday settle, append that window from paper-mode logs (label: live observation).
**Share card:** one generated image per window (Open Graph) for X: "Weekend of 26–28 Sep: 3 tokens above 20%,
$X paid above the real price." Numbers from data files only.
**Rules:** show sample sizes everywhere; mark excluded tickers and why (e.g. SATS, MSTR) in a footnote.
**Acceptance:** every window since 1 Jul listed; numbers match harm/replay files (single-source test); card renders.

## Feature 3 — Personal sell order (`/sell`) — testnet only
**What it is:** a sell-only Uniswap v4 range order placed from the user's own wallet, priced as a premium over the
verified reference price. Non-custodial: Offmint never holds the tokens.

**Step 0 (gate, do first, ≤2 hours):** verify on testnet 46630 whether Uniswap v4 **PositionManager** and **Permit2**
exist and work with our sandbox pool. Report addresses.
- If yes: build on PositionManager. **No new contracts.**
- If no: **stop and report.** Do not write a new helper contract without the user's approval. Fallback is shipping
  the weekend report alone.

**Flow:**
1. Pick token (ticker badge + Robinhood icon) and amount. Show: verified reference price, minting status and
   countdown, current pool price.
2. Choose level: suggested buttons (+10%, +20%, +40%), each showing how often past windows reached it, with counts
   ("2 of 14") from weekend-report data. Custom % allowed with a minimum of +5%.
3. App computes a one-sided range strictly above the current price, orientation-aware (same rules as RangeMath §5:
   round away from current price, respect tickSpacing). Refuse if the pool price is already at/above the level.
4. Place via PositionManager (Permit2 approval flow). Show the tx on Blockscout.
5. Order view: % filled, USDG received so far, tokens remaining.
6. "Collect": remove the position; user receives USDG + unsold tokens.
7. Optional "Buy back" (after reopen only): swap USDG → token, capped at fresh reference × 1.01; show the price before
   confirming.

**Always-visible risk text:** "This is a sell order. If it fills you hold USDG, not the stock. If the real price rises,
you don't get your shares back automatically."

**Tests:** TS tick math matches Solidity RangeMath for both orientations (shared test vectors); range never touches or
crosses current tick; minimum premium enforced in the UI; end-to-end on sandbox pool: place → sandbox squeeze fills →
collect → buy back.

**Sandbox link:** the sandbox's "simulate squeeze" step should also fill a user's open sell order, so a judge can try
the sell order end to end in ~2 minutes.

---

## Revised schedule (today = Sat 26 Sep)
| Day | Work |
|---|---|
| Sat 26 | Finish Phase 1 runs (harm, replay, frequency). Sell-order **Step 0 gate**. Paper mode live. |
| Sun 27 | Weekend report (page + detail + data wiring). Faucet. |
| Mon 28 | Instant sandbox. Paper weekend 26–28 Sep report → first live row in the weekend report. Share card. |
| Tue 29 | Personal sell order (if gate passed). Verified-premium gate on monitor. |
| Wed 30 | Sell order finish + sandbox link. Landing rebuild starts (four-feature story). |
| Thu 1 | Landing finish. Slither, threat model (include sell-order flow), CLAIMS.md, README. |
| Fri 2 | Submission materials, judge simulation, fixes. **Code freeze end of day.** |
| Sat 3 | User records video. Link check. |
| Sun 4, before 07:59 UTC | User submits Singapore. |

**If behind by Wed 30:** cut the personal sell order (keep weekend report). Never cut the foundation, sandbox, or
landing hero.

## Report back
After the Step 0 gate (addresses, yes/no), and at the end of each day: what shipped, what slipped, and any number that
changed.
