# FINISH status (docs/FINISH.md)

Every ✅ links its evidence (commit, CI run, test, screenshot, tx hash or file). ⬜ = not done yet, ⚠️ = done with a
stated caveat. Updated after every block.

| Item | Status | Evidence |
|---|---|---|
| **A1** Commit today's work; push; CI green | ✅ ⚠️ | Commit `4d3214d` pushed to `main`; CI run [36224910121](https://github.com/offmint/offmint/actions/runs/36224910121): contracts, keeper, web, e2e all `success`. Caveat: landed as one commit, not several logical ones (already pushed; not rewritten). Later work is split by block. |
| **A2** Track `docs/` | ✅ | Commit `ba28182`: `.gitignore` now tracks `docs/**` incl. markdown (45 files). Scanned first: no keys, key-bearing RPC URLs or personal data. Note: WINPLAN/FEATURES/TAILOR/AIRTIGHT/BITGET/FINISH are still root-owned on disk (`sudo chown -R $(whoami) docs/` pending), so they can be committed but not edited by the agent. |
| **A3** `docs/DECISIONS.md` | ✅ | Commits `1a45685` (+ earlier content): D0 entries (no Colosseum, no Unichain), D1 Bitget Open Theme, D2 pitch + MetaVault one line with picker result, D3 four features, D6 "paid above the reference price", D8 Robinhood `logoUrl` icon policy, D7 in-browser sandbox. |
| **B1** Harm wording: both numbers, exact labels | ✅ | `$3,615,154` = amount **paid above the reference** on buys priced >5% above it; `$17,594,088` = **value of those buys** (121,905 buys, 21,419 wallets). Both shown and labelled on `/weekends` (totals + per window), `/weekends/[date]` (per token), share card: [B1-weekends-1440.png](screenshots/B1-weekends-1440.png), [B1-weekend-2026-08-29-1440.png](screenshots/B1-weekend-2026-08-29-1440.png), [B1-sharecard-2026-08-29.png](screenshots/B1-sharecard-2026-08-29.png). Same definition as the old 25 Jul figure: "$28,328" was the excess at 2%; at 5% it is $24,775 on $109,866 of buys (CLAIMS.md). Tests: `weekend report agrees with harm.json` + `period totals equal harm.json totals` (web/test/claims.test.ts). Commit `7b74a35`, CI [36226599579](https://github.com/offmint/offmint/actions/runs/36226599579). |
| **B2** Monitor + verified-premium gate | ✅ | Gate live in code: `web/src/lib/liveGate.ts` (tested in `web/test/liveGate.test.ts`), `/api/live` returns `maxVerified` from verified rows only, landing stat shows "highest verified live premium" or "None". Root cause of INDA/ELF (wide off-hours reference quotes) in `docs/verification/premiums.md`. `/monitor` labels each row verified/unverified with the reason: [B2-monitor-1440.png](screenshots/B2-monitor-1440.png). Also fixed: countdown said "opens in 6d" during the open weekend window, now "Minting off now · reopens in …" (commit `4398ad7`). |
| **B3** Token icon = Robinhood `logoUrl` | ✅ | `/api/logo/[ticker]` 302-redirects only to `https://cdn.robinhood.com/...` from `/rhj/assets` `logoUrl` (404 otherwise; the UI then shows the ticker badge alone). Checked 26 Sep: 195 assets, 195 distinct URLs, and the files are identical (sha256 prefix `3acff25ee4e8f842` for LMT and 3 others): Robinhood's lime feather, the same image for every Stock Token by design. `curl localhost:3001/api/logo/LMT` -> 302 to `.../0x329fcaceb9ad6f9580dd5f643fed0646900d043c.png`; unknown ticker -> 404. Policy in DECISIONS D8. |
| **B4** Hero P0 from data + test | ✅ | `HeroChart.tsx` reads `EVENTS[0].p0` (screen data); caption "Reference $29.87 is the pool price at Fri 20:00 UTC (NYSE close $28.84)". Test `hero Friday price (P0) is read from data…` renders the hero and checks it (commit `e9d1935`, CI [36226599579](https://github.com/offmint/offmint/actions/runs/36226599579)). |
| **B5** Fork numbers show pinned block | ✅ | All three fork-derived places show block 71241990: Verify ("mainnet-fork tests @ block …"), HowItWorks worked example, README proof row. Test `every fork-derived number shows its pinned block` also pins the README fork-test count to tests.json (commit `e9d1935`). |
| **B6** CLAIMS.md: today's numbers + test | ✅ | `docs/CLAIMS.md` rows added for replay range, normal/worst weekend, capacity, harm (value of buys + paid above + wallets, 2% detail, 25 Jul definition check), frequency 4 of 11 windows, mint-off 31.23%, sell-order contracts, sandbox; stale rows ("two ways", MetaVault +0.44%) removed. Test `CLAIMS.md ledger rows match their data files`. Found stale on the landing: "76 keeper+backtest tests" -> 99; CI now fails if that count drifts (keeper job, run [36226599579](https://github.com/offmint/offmint/actions/runs/36226599579)). |
| **C1** Mint-off section (31.2% arithmetic) | ⬜ | |
| **C2** Weekend report auto-update | ⬜ | |
| **C3** Sell order, real testnet wallet | ⬜ | |
| **C4** Vault, real testnet wallet | ⬜ | |
| **C5** Sandbox: simulated vs onchain stated | ⬜ | |
| **D1** Public deployment, every route | ⬜ | Block B is ✅ (CI green on `37e2502`), so D1 is unblocked. |
| **D2** WalletConnect hidden without ID | ⬜ | |
| **D3** Landing around four features + screenshots | ⬜ | |
| **D4** Alchemy in every service | ⬜ | |
| **D5** Railway volume persistence | ⬜ | |
| **E1** Threat model: sell-order flow | ⬜ | |
| **E2** Slither re-run | ⬜ | |
| **E3** README first screen, features, roadmap, fees, reproduce | ⬜ | |
| **F1–F5** Singapore materials, link check, freeze | ⬜ | |
| **G1** Paper + poster weekend reports | ⬜ | Collecting now (paper armed Sat 00:00 UTC; poster dry run running). |
| **G2** Bitget package | ⬜ | |
