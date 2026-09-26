# Bitget AI Base Camp Hackathon S2 — Offmint entry

**Track:** Alpha Factory (Quantitative Strategies) → sub-theme **Arbitrage**
**Deadline:** 8 Oct 2026 (UTC+8) — moved from 27 Sep; confirm the exact hour on the form. Internal target: ready by 7 Oct. See also docs/TAILOR.md.
**Scoring:** purely quantitative — Sharpe, Sortino, max drawdown, turnover, out-of-sample Sharpe decay
(alert if OOS < 0.5 × IS), rolling 30-day Sharpe stability.
**Hard requirement:** backtest total period ≥ 60 days, out-of-sample ≥ 30 days.

Priority order is strict: the AIRTIGHT P0 backtest fix comes first, because every number below depends on it.

---

## 0. Blocker — fix the backtest engine first
Resolve `docs/AIRTIGHT.md` item 2 (MSTR +243% / −100%) before producing any Bitget number. If the engine had a
bug, fix it, add a regression test, and re-run everything. Report which published numbers changed.

## 1. Define the strategy as Bitget will score it
Name: **"Weekend Supply" — mint-freeze arbitrage on tokenized US stocks (Robinhood Chain).**
- Universe: every Robinhood Stock Token with a STOCK/USDG Uniswap v4 pool, per weekend, eligible if pool TVL ≥
  $10,000 at the weekend freeze (same floor as the detector). Canonical addresses only.
- Position: hold the token (equal capital per eligible ticker). Deploy 30% of each holding into the 4-rung ladder
  (current default rungs) above the reference price at the freeze (Sat 00:00 UTC in this period).
- Exit: settle after reopen per the vault's rules (fresh price, capped buyback).
- **Return definition: excess return over simply holding the same tokens** (extra shares × Monday reference
  price, divided by capital). This isolates the strategy's alpha and removes stock-market direction.
  Weekdays = 0. Squeeze weekend = positive. Gap-up weekend = negative.
- Costs, all included: pool fee on every swap, slippage from actual pool liquidity, gas.
- Market impact: use the **"with our own supply" replay** (AIRTIGHT item 7) — replay weekend swaps against the
  pool with our ladder liquidity added. Report raw replay and with-supply replay; **headline = with-supply**.

## 2. Periods
- Full: first complete weekend after mainnet launch (≈3 Jul) → weekend of 19–21 Sep. Must be ≥ 60 days.
- In-sample: ≈3 Jul → 16 Aug. Out-of-sample: 17 Aug → 21 Sep (≥ 30 days). Print exact dates and day counts.
- Parameters are fixed for the OOS period (no tuning inside it).
- **Disclosure (must appear in the report and description):** the ladder parameters were designed after the
  HIMS spike (29 Aug, inside OOS) was observed, so the OOS period is not fully blind. Mitigation: §3's
  sensitivity grid, and live paper-trading weekends from 26 Sep onward with parameters frozen *before* them.

## 3. Metrics (produce all, IS / OOS / full)
Daily excess-return series (state annualization: √365, since tokens trade 7 days a week):
- Annualized Sharpe, Sortino, max drawdown, win rate (per weekend-ticker event), number of events,
  **number of nonzero events**, turnover, total fees + slippage paid.
- OOS Sharpe vs IS Sharpe, with the 0.5× decay check stated explicitly (pass/fail).
- Rolling 30-day Sharpe chart. Where a window has no nonzero events, Sharpe is undefined — show it as a gap and
  explain; don't fill it.
- **Parameter sensitivity grid:** vary first-rung premium (e.g. 4–15%), ladder width, deploy % (10–50%); show
  Sharpe and total excess return for each cell as a heatmap. Mark the chosen setting.
- Per-event table: date, ticker, reference, peak premium, shares sold, buyback price, net excess, costs.
- Put the event count next to every Sharpe figure. With ~2 real squeezes the Sharpe is statistically fragile;
  say that in one sentence.

## 4. Deliverables (all under `bitget/` in the repo)
- `bitget/README.md` — the report: strategy, universe, periods, costs, all metrics, charts, disclosure, how to
  reproduce in one command.
- `bitget/run_backtest.*` — one command reproduces every number from raw onchain data (pinned block ranges).
- `bitget/results/*.json|csv` — raw metric outputs + per-event table.
- `bitget/charts/*.png` — equity curve (excess), drawdown, rolling Sharpe, sensitivity heatmap, HIMS & GLXY events.
- `bitget/SUBMISSION.md` — form answers ready to paste:
  1. **Project description** in six parts: (1) Thesis (highest weight): mint/redeem is the arbitrage that keeps
     tokens at NAV; it switches off every weekend; scarcity premiums appear (HIMS +317.6%, GLXY +186.1%, new
     listings without price feeds); the strategy supplies exactly then. Risk controls: ladder only above the
     reference, capped buyback, deploy cap, pause/stale-price checks. (2) Target user: be concrete — holders of
     newly listed tokenized US stocks on Robinhood Chain; non-US retail/pro with multi-week holding horizon,
     small–mid capital; want extra return without selling. No "all traders". (3) Validation: every metric,
     labeled observed / simulated / estimated, event count, costs, disclosure; plan to prove usage (vault deposits,
     live weekends). (4) Progress: what's built (contracts, tests, testnet deploy, paper trading), what's not
     (mainnet, audit), next steps. (5) Deliverables list. (6) Optional take on AI trading.
  2. **Role of the LLM:** honest — Claude (via Claude Code) wrote and tested code, ran data analysis, and helped
     design the backtest; the live strategy itself is rules-based and makes no LLM decisions. No Qwen credits used
     (unless they were).
  3. **Materials link:** GitHub `bitget/` folder URL (+ live site `/paper` for weekends after the deadline).
  4. **X post draft** (≤ 280 chars) with #BitgetHackathon and @Bitget_AI, quoting
     https://x.com/Bitget_AI/status/2100519318824055159 — lead with the HIMS spike and "we supply the weekend".

## 5. Rules
- No mainnet transactions. Onchain reads only.
- Every number in SUBMISSION.md must match `bitget/results/`; add a check that fails if they differ.
- Never claim the strategy is risk-free or that returns are guaranteed. Label simulated results as simulated.
- Don't pad: if a metric looks bad (e.g. OOS decay fails), report it and explain. Judges score honesty poorly
  when they catch it missing.

## Report back
Exact periods and day counts, headline metrics (with-supply), IS vs OOS Sharpe and the decay check, event
counts, anything that failed, and the paths to SUBMISSION.md and the charts.
