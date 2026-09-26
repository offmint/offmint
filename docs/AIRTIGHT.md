# Offmint — AIRTIGHT: verification directive

Goal: before judges see anything, **every number and claim on the site is either verified, clearly labeled, or
removed.** No exceptions. Work top to bottom. For each item write a short finding in `docs/verification/`.

## Ground rules (apply to everything)
1. **Single source of truth for displayed numbers.** Every number the site shows is read from a data file
   (`web/public/data/*.json` or the live API route), never typed into a component and never derived backwards
   from a result. Add a test that fails the build if a rendered number differs from its data file.
2. **Claims ledger.** Create `docs/CLAIMS.md`: every public claim/number → source file or URL → status
   (`verified` / `simulated` / `live-computed` / `unverified`). Nothing `unverified` ships on the landing page.
3. **Labels.** Simulated numbers say "simulated". Live numbers say "live". Fork numbers show the pinned block.
4. **When unsure, remove.** A missing stat costs nothing; a wrong one costs credibility with every judge.

## Approvals
- Testnet redeploy of MetaVault (item 12): **approved.**
- Mainnet price-poster **read-only dry run** (item 8), no transactions: **approved.**
- Any mainnet transaction: **not approved.**
- `OffmintVault` stays untouched.

---

## P0 — fix before the site is public

### 1. Live premiums (INDA +24.96%, ELF +13.18%)
Investigate both and write `docs/verification/premiums.md` with the root cause. Candidates: thin or stale pool,
unit mismatch (decimals, `currentMultiplier` applied twice or not at all, ETF share units), wrong pool picked,
reference price stale, or a genuine gap.
Then add a **quality gate**; a premium is "verified" only if ALL pass:
- pool TVL ≥ $10,000 (same floor as the detector);
- a $1,000 swap moves the pool price < 2%;
- last swap in that pool < 6 h ago (else "stale pool");
- reference price fresh (within max age) and multiplier applied exactly once (unit test with a known token);
- pool price agrees with an independent source (e.g. GeckoTerminal) within 2% — if the source is down, the
  premium is "unverified", not "verified".
The landing stat becomes **"Highest verified live premium"** and uses only verified premiums; if none, show
"None right now". `/monitor` may show unverified rows, flagged with the reason.

### 2. MSTR +243% weekend / −100% simulated vault
A −100% vault result is impossible under the vault's own rules, so this is either bad input data or a bug in the
backtest engine. Find out which. Check: multiplier / corporate action that weekend, decimals, pool orientation,
reference price, and the buyback math. Write `docs/verification/mstr.md`.
- If it's an **engine bug**: fix it, add a regression test, **re-run every backtest**, and update every published
  number (HIMS, GLXY, all bars). Report any number that changed.
- If it's **bad data**: keep MSTR excluded, with the documented reason.

### 3. Tokenization window — VERIFIED, add the source
Confirmed against Robinhood's own documentation:
- Robinhood Chain docs (docs.robinhood.com/chain/stock-tokens/): minting and burning are not supported outside
  the tokenization window, and end users can still trade Stock Tokens onchain outside it.
- Robinhood support ("About Stock Tokens", robinhood.com/eu/en/support/articles/about-stock-tokens):
  Monday 02:00 CET/CEST until Saturday 02:00 CET/CEST, closed on US market holidays.
Link both on the site where the window is stated, and mention holidays ("weekends and US market holidays").

### 4. Logos — replace with Robinhood's token icon
Third-party logos matched by ticker can show the wrong company (FLY, P, ON…). Remove Parqet/FMP logos and the
dependency. Use Robinhood's own token icon (`logoUrl` from `/rhj/assets`) next to the ticker badge, following the
rules in `docs/ASSETS.md` §2.

### 5. Hero "Friday price $29.87"
Read P0 directly from the HIMS backtest data. Do not derive it from +317.6%. State which reference it is
(e.g. "reference price at weekend freeze"). Note: the widely reported NYSE close for HIMS on 28 Aug was $28.84 —
if our P0 differs, the caption must say exactly what our number is and why it differs. Recompute +317.6% from
the same P0 and pool data and confirm they match.

### 6. Public hosting + mobile wallets
- Deploy the web app publicly (Railway web service) and put the URL in README.
- WalletConnect project ID: the user will create one (item U2). Read it from env; if missing, hide the
  WalletConnect option rather than showing a broken button.

---

## P1 — before submission (Oct 4, 07:59 UTC)

### 7. Returns are simulated — label them, and model our own impact
- Every return figure (+8.1% on ladder capital, +0.44% whole vault) carries "simulated" + source + fork block.
- Add a **"with our own supply" replay**: replay the weekend swaps against the pool *with our ladder's liquidity
  added*, so buyers hit our orders and the spike is smaller. Report both the raw replay and the with-supply
  replay. If this can't be done well in time, state plainly on the site that real results would be lower because
  our orders shrink the spike.

### 8. Mainnet price poster — read-only dry run this weekend
Run the poster against mainnet with transactions disabled. Log what it would post; where a Chainlink feed exists,
compare our computed price to Chainlink and record the error. Write `docs/verification/poster.md`.

### 9. SELECT — validate point-in-time
For each past weekend with data, compute SELECT scores using **only data available before that Thursday**. Report:
would it have picked HIMS (29 Aug) and GLXY (12 Sep)? How many false picks? Write `docs/verification/select.md`.
- If it would have caught them: say so, with the data.
- If not: the site says MetaVault's picker is **experimental and unvalidated**, and the pitch leads with the
  community vault. Do not claim the picker works.

### 10. Paper trading — first real weekend (26–28 Sep)
Confirm it's running before Sat 00:00 UTC. Afterwards write `docs/verification/paper-2026-09-26.md`:
what happened, squeeze or no squeeze, reported honestly either way. Repeat for Oct 3–4.

### 11. Security
- Run Slither on all contracts; fix or triage every finding in `docs/verification/slither.md`.
- Write `docs/THREAT_MODEL.md`: keeper key, poster key, owner key, oracle manipulation, sandwiching, stale prices,
  what each key can and cannot do.
- Site and README say **"Unaudited. Testnet only."**

### 12. Testnet MetaVault = repo code
Redeploy MetaVault (approved) so the deployed contract includes the "no buy-in without a scheduled weekend"
guard. Verify on Blockscout and confirm the deployed bytecode matches the repo build. Update every address
(README, config, site).

### 13. Fork-test numbers drift
Pin the fork block for every published fork number. Show the block in captions ("mainnet fork @ block N").

### 14. Railway volume persistence
Write a marker file to `/data`, redeploy, confirm the marker survived. Record the result.

### 15. Alchemy variables
Add a startup log line showing which RPC **host** is in use (never the key): `RPC: alchemy` or
`RPC: public fallback`. Print the exact env variable names the code expects so the user can compare.

---

## User actions (Claude Code: tell the user when each is needed)
- **U1 — Alchemy .env check.** Run in the repo root (shows names only, hides values):
  `grep -n 'ALCHEMY' .env | sed 's/=.*/=<hidden>/'`
  Then check for: spaces around `=`, quotes around the URL, a leading `export`, Windows line endings
  (`grep -c $'\r' .env` should print 0), and that names exactly match what the startup log says the code expects.
- **U2 — WalletConnect project ID:** create a project in the WalletConnect (Reown) cloud dashboard, add the ID to
  the web service's environment variables.
- **U3 — Railway:** redeploy when asked; confirm the public URL.

## Done means
- `docs/CLAIMS.md` has no `unverified` rows used on the landing page.
- Findings written for items 1, 2, 8, 9, 10, 11.
- All tests + CI green; build fails if a displayed number doesn't match its data file.
- Report back: what changed, which numbers moved, and anything still open.
