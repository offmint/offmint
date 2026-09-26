# Offmint — WIN PLAN (single source of truth for what to do next)

This file **supersedes** the task order and any conflicting instructions in NEXT.md, TAILOR.md, AIRTIGHT.md,
BITGET.md, LANDING_BRIEF.md and ASSETS.md. Those files still hold the details; this file decides order and settles
conflicts.

## Scope
- **Two entries only:** Arbitrum Open House Singapore (**Sun 4 Oct, 07:59 UTC**) and Bitget AI Base Camp S2
  (**8 Oct, UTC+8**, user confirms hour). **No Colosseum, no Unichain** — skip any task for them.
- **Settled conflicts:**
  - Sandbox = **instant, compressed time** (a full cycle in ~2 minutes), not the 30-minute/35-minute design in
    NEXT.md Task 3.
  - Token icons = **Robinhood's `logoUrl` icon next to the ticker** (ASSETS.md §2), no third-party company logos.
  - Landing = **light first, Ethena-style data-forward**, per LANDING_BRIEF.md "Chosen direction".
  - Pitch leads with the **community vault**; MetaVault is shown as **experimental**.
- Approvals unchanged: testnet broadcasts for sandbox/faucet/MetaVault redeploy approved; **no mainnet transactions**;
  **don't modify OffmintVault**.

## What judges see, in order (optimise this path above everything else)
1. **README first screen** (repo) — one-line pitch, the HIMS chart, live links (site, sandbox, video), "unaudited,
   testnet" note. A judge decides in 30 seconds whether to keep reading.
2. **3-minute video.**
3. **Landing page** — the hero weekend card and the stat band.
4. **Sandbox** — a full cycle in ~2 minutes from an empty wallet (faucet included).
5. **Contracts + tests** — verified addresses, test counts, Slither report, threat model.
Every task below exists to make one of these five stronger.

## Schedule (today = Fri 25 Sep)

### Fri 25 – Sat 26: foundation
1. Backtest engine fix (AIRTIGHT 2, MSTR). **Blocker for all numbers.**
2. With-supply replay (AIRTIGHT 7). Headline numbers use it.
3. Confirm paper mode is running on Railway **before Sat 26 Sep 00:00 UTC** (AIRTIGHT 10).
4. Harm scan (TAILOR Phase 1 item 3).

### Sun 27 – Mon 28: evidence + demo
5. Premium frequency table and mint-off window size (TAILOR Phase 1 items 4–5).
6. Faucet (NEXT Task 2) and **instant sandbox** (compressed time; see Scope).
7. Paper weekend report for 26–28 Sep, honest either way.
8. SELECT point-in-time validation (AIRTIGHT 9) — decides how MetaVault is labelled.

### Tue 29 – Wed 30: the page
9. Verified-premium quality gate for live numbers (AIRTIGHT 1); Robinhood token icons (AIRTIGHT 4).
10. Landing rebuild per LANDING_BRIEF.md, with Playwright screenshots at 1440 px and 390 px after each section.
11. Hero P0 read from data, not derived (AIRTIGHT 5). Single-source-of-truth test for every displayed number.
12. Public hosting live; WalletConnect handled (AIRTIGHT 6).

### Thu 1 Oct: credibility
13. Slither report, THREAT_MODEL.md, "Unaudited. Testnet only." everywhere (AIRTIGHT 11).
14. Testnet MetaVault redeploy so deployed = repo (AIRTIGHT 12). Pin fork blocks in captions (AIRTIGHT 13).
15. `docs/CLAIMS.md` complete; nothing `unverified` on the landing page.
16. README rewrite (first screen as above), roadmap, fee model, one-command reproduce script (NEXT Task 4).

### Fri 2 Oct: submission materials + judge simulation
17. `docs/submission/`: HACKQUEST.md (built around TAILOR's criteria table), DEMO_SCRIPT.md + shot list, DECK.md,
    QA.md.
18. **Judge simulation:** open the repo, site and sandbox as a first-time judge. Score each Singapore criterion
    (contract quality, product-market fit, innovation, real problem) 1–10 with one sentence of evidence each, list
    the three weakest points, and fix what can be fixed today. Write it to `docs/submission/JUDGE_REVIEW.md`.
19. **Code freeze at end of day** except fixes for broken things.

### Sat 3 Oct
20. User records the video from the script. Claude Code: final link check (every link in README/site/submission
    resolves), final CI green, paper mode running for the 3–5 Oct weekend.

### Sun 4 Oct — before 07:59 UTC
21. **User submits Singapore on HackQuest.**

### Mon 5 – Wed 7 Oct: Bitget
22. BITGET.md package, including the 26–28 Sep and 3–5 Oct weekends as frozen-parameter out-of-sample evidence.
23. SUBMISSION.md numbers checked against `bitget/results/`.

### By Thu 8 Oct
24. **User posts the X post and submits the Bitget form** (Alpha Factory → Arbitrage, university name filled in).

## Rules that never bend
- Every public number: from a data file, labelled (simulated / live / fork @ block), listed in CLAIMS.md.
- Never "risk-free", "safe", "guaranteed"; never call the keeper AI.
- Never claim Offmint calms, stabilises or prevents weekend spikes — the with-supply replay shows it barely lowers
  the peak at today's sizes. The claim is: holders earn from the premium; capacity is limited by pool depth.
- If a result is weak, report it plainly and adjust the pitch — don't hide it.
- If a task slips, drop from the bottom of the day's list, never the foundation (items 1–3) or the judge path.

## Report back
At the end of each day block: what shipped, numbers produced, anything weaker than expected, and what's at risk for
the Oct 4 deadline.
