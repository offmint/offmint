# FINISH status (docs/FINISH.md)

Every ✅ links its evidence (commit, CI run, test, screenshot, tx hash or file). ⬜ = not done yet, ⚠️ = done with a
stated caveat. Updated after every block.

| Item | Status | Evidence |
|---|---|---|
| **A1** Commit today's work; push; CI green | ✅ ⚠️ | Commit `4d3214d` pushed to `main`; CI run [36224910121](https://github.com/offmint/offmint/actions/runs/36224910121): contracts, keeper, web, e2e all `success`. Caveat: landed as one commit, not several logical ones (already pushed; not rewritten). Later work is split by block. |
| **A2** Track `docs/` | ✅ | Commit `ba28182`: `.gitignore` now tracks `docs/**` incl. markdown (45 files). Scanned first: no keys, key-bearing RPC URLs or personal data. Note: WINPLAN/FEATURES/TAILOR/AIRTIGHT/BITGET/FINISH are still root-owned on disk (`sudo chown -R $(whoami) docs/` pending), so they can be committed but not edited by the agent. |
| **A3** `docs/DECISIONS.md` | ✅ | Commits `1a45685` (+ earlier content): D0 entries (no Colosseum, no Unichain), D1 Bitget Open Theme, D2 pitch + MetaVault one line with picker result, D3 four features, D6 "paid above the reference price", D8 Robinhood `logoUrl` icon policy, D7 in-browser sandbox. |
| **B1** Harm wording: both numbers, exact labels | ⬜ | |
| **B2** Monitor + verified-premium gate | ⬜ | |
| **B3** Token icon = Robinhood `logoUrl` | ⬜ | |
| **B4** Hero P0 from data + test | ⬜ | |
| **B5** Fork numbers show pinned block | ⬜ | |
| **B6** CLAIMS.md: today's numbers + test | ⬜ | |
| **C1** Mint-off section (31.2% arithmetic) | ⬜ | |
| **C2** Weekend report auto-update | ⬜ | |
| **C3** Sell order, real testnet wallet | ⬜ | |
| **C4** Vault, real testnet wallet | ⬜ | |
| **C5** Sandbox: simulated vs onchain stated | ⬜ | |
| **D1** Public deployment, every route | ⬜ | Blocked until Block B is ✅ (FINISH + user instruction). |
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
