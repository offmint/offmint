# Offmint — FINISH: tick every box

Goal: every item below is ✅ with evidence (test, screenshot, tx hash, or file) before **Fri 2 Oct code freeze**.
Work in the order given. After each block: commit, push, CI green, one-line report per item.

## Approvals (explicit)
- **Commit and push now**, and after every block.
- **Testnet transactions from a dedicated test wallet are approved** for: placing/collecting a sell order, a vault
  deposit/withdraw, sandbox runs. Never use a wallet that holds anything real.
- **Public deployment of the web app is approved** (Railway web service; Vercel acceptable if faster).
- **Mainnet transactions: not approved.** `OffmintVault`: not modified.

---

## Block A — today, first hour
A1. Commit today's work in logical commits; push; CI green. Report the commit hashes.
A2. Remove the `docs/` line from `.gitignore`. (The user fixes file ownership with `sudo chown -R $(whoami) docs/`.)
    Then `git add docs/`, check `git status` for anything secret (keys, .env, private data) before committing.
A3. Write `docs/DECISIONS.md`: pitch = community vault first; MetaVault one line (experimental, picker missed HIMS);
    four features (Monitor, Weekend report, Sell order, Vault); Bitget → Alpha Factory → **Open Theme**; no Colosseum,
    no Unichain; Robinhood `logoUrl` icon policy; "paid above the reference price" wording.

## Block B — correctness of today's numbers (before anything is shown publicly)
B1. **Harm scan wording.** State exactly what $3.62M is: total purchase volume of buys priced >5% above reference, or the
    excess amount paid above reference? Show **both** numbers, each labelled precisely, e.g. "$X of buys at >5% above the
    reference; $Y paid above the reference on those buys." The 25 Jul figure ($28,328) and the 12-window total must use
    the same definition. Fix every page, card and doc to match.
B2. **Monitor re-check + verified-premium gate** (AIRTIGHT 1). Confirm the gate is live: INDA/ELF root cause written in
    `docs/verification/premiums.md`; headline stat uses only verified premiums. Screenshot `/monitor`.
B3. **Token icon.** Confirm the icon shown is Robinhood's image from `/rhj/assets` `logoUrl` (identical for all tokens by
    design), not a generic fallback. If it's the generic fallback, switch to `logoUrl` with badge fallback on load error.
B4. **Hero P0** (AIRTIGHT 5): read from data, caption says which reference; test covers it.
B5. **Fork numbers** (AIRTIGHT 13): every fork-derived number shows its pinned block.
B6. **CLAIMS.md**: add every new number from today (replay per $1,000 range, worst −0.1%, capacity ≈$1,647, harm totals,
    frequency 1-in-3, mint-off 31.2%) with source file and status. Claims test must cover them.

## Block C — the four features, fully working
C1. **Mint-off page/section**: show the 31.2% arithmetic (weekends + holidays, our 02:00–02:00 Berlin holiday
    assumption stated) with links to the two Robinhood sources. Numbers from `mintoff.json`.
C2. **Weekend report auto-update**: after each Monday settle, append the window from paper-mode logs, labelled "live
    observation". Test with a fixture; then run it for real after Mon 28 Sep.
C3. **Sell order with a real testnet wallet**: place a sell order on the sandbox pool from the browser, trigger the
    sandbox squeeze, confirm fill, collect, and (after reopen) buy back. Record every tx hash on Blockscout in
    `docs/verification/sellorder-live.md`. Include the case where the pool is already above the reference (the UI must
    refuse or re-anchor correctly).
C4. **Vault with a real testnet wallet**: deposit into the community vault from the browser, run a sandbox cycle,
    withdraw. Record tx hashes in `docs/verification/vault-live.md`.
C5. **Sandbox**: link the in-browser sandbox to the deployed onchain sandbox where possible, or state clearly on the page
    which parts are simulated in the browser and which are onchain. No ambiguity.

## Block D — public site
D1. Deploy the web app publicly; put the URL in README and on the HackQuest draft. Check every route loads on desktop
    and phone: `/`, `/monitor`, `/weekends`, `/weekends/[date]`, `/sell`, `/app`, `/sandbox`.
D2. WalletConnect: if `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is missing, hide the option (no broken button); tell the
    user when the ID is needed.
D3. Landing rebuilt around the four features (LANDING_BRIEF + FEATURES story: see it → learn → act yourself → or let
    the vault do it). Playwright screenshots at 1440 and 390 px of every section, saved in `docs/screenshots/`.
D4. Alchemy: startup log shows `RPC: alchemy` in every service (AIRTIGHT 15). If still falling back, tell the user
    exactly which variable name is expected.
D5. Railway volume persistence test (AIRTIGHT 14): marker file survives a redeploy.

## Block E — credibility
E1. Threat model: add the sell-order flow (Permit2 approvals, wrong PositionManager risk — only
    `0x58daec3116aae6D93017bAAea7749052E8a04fA7` is valid, pricing anchored to reference, user-owned position).
E2. Re-run Slither on current contracts; update the report.
E3. README: first screen (pitch, HIMS chart, live links, "unaudited, testnet"), plain-English explanation, four
    features, roadmap (testnet → audit → capped mainnet → RFQ/aggregator buybacks → launchpad pool supply → other
    issuers → onchain canonical-token check), fee model, one-command reproduce.

## Block F — Singapore submission materials (Fri 2 Oct at the latest)
F1. `docs/submission/HACKQUEST.md` — built on TAILOR's criteria table, four-feature story, all numbers from CLAIMS.md.
F2. `DEMO_SCRIPT.md` + shot list (3 min): problem (HIMS) → mint-off window → weekend report → sell order → vault →
    honest limits.
F3. `DECK.md` (5 slides), `QA.md` (include: "isn't this a Uniswap limit order?", "why so small?", "does it calm the
    spike?" — answer honestly: no, not at current size).
F4. `JUDGE_REVIEW.md` — first-time-judge pass: score each Singapore criterion 1–10 with evidence, list the 3 weakest
    points, fix what can be fixed the same day.
F5. Final link check: every link in README, site and submission resolves. CI green. **Code freeze.**

## Block G — after the weekend (Mon 28 Sep onward)
G1. Paper-weekend report `docs/verification/paper-2026-09-26.md` and poster dry-run report
    `docs/verification/poster.md`; first live row in the weekend report.
G2. Bitget package (Phase 3, BITGET.md, Open Theme framing: market impact and capacity), by 7 Oct.

## Done means
Every item above has its evidence listed in one table in `docs/FINISH-STATUS.md` (item → ✅ → evidence link). Nothing
marked ✅ without evidence.
