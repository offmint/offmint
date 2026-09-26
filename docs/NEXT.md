# Offmint — NEXT (submission sprint)

Read CLAUDE.md and docs/SPEC.md first. This file is the task list from now until submission.
**Protocol work is frozen.** The contracts are done for judging purposes. Everything below is about letting
judges *experience* the product and *understand* it.

## Deadlines
| Event | Deadline | Where |
|---|---|---|
| Arbitrum Open House Singapore | **Sun 4 Oct 2026, 07:59 UTC** (15:59 SGT) | HackQuest |
| Colosseum Crypto World's Fair (Robinhood track) | 12 Oct 2026 (confirm hour on Arena) | Colosseum |
| Superteam sidetracks (only if eligible) | 13 Oct 2026, 06:59 UTC | Superteam Earn |

Judging (Singapore): smart contract quality · product-market fit · innovation · solves a real problem.
Baseline deployment: Arbitrum Sepolia or Robinhood Chain testnet (46630). We are already deployed on 46630.

## Approvals
- **Testnet (46630) broadcasts for Tasks 2 and 3 are approved.** Use `--slow` as in the last deploy.
- **Mainnet is NOT approved.** Do not deploy, broadcast, or prepare mainnet transactions.
- **Do not modify `OffmintVault`.** It has ~788 bytes of headroom under the 24 KB limit. Sandbox and faucet must
  reuse existing contracts as-is. If a task seems to need a vault change, stop and report instead.

## Hard rules for all copy (landing, README, video script, submission text)
- Never say "risk-free", "safe", or "market-neutral" about MetaVault. The community vault may be described as
  adding no new market exposure *because the depositor already held the stock*.
- Never call the keeper "AI". It is a rules-based bot.
- Always show the two return numbers together, labeled (Task 5).
- Every performance number must come from our own tests/replays/testnet runs, with its source named.

---

## Task 1 — Housekeeping (30 min, do first)
1. **One SPEC only.** Diff root `SPEC.md` against `docs/SPEC.md`. Merge anything only in the root copy into
   `docs/SPEC.md`, then delete the root copy. CLAUDE.md points at `docs/SPEC.md`; that is canonical.
2. Confirm the Railway **web** service is on the latest commit and the public URL loads `/`, `/app`, `/monitor`.
   (If a redeploy is needed, tell the user: Railway → service → Deployments → Redeploy newest.)
3. Point every RPC config (web, keeper, paper mode, Railway env) at the Alchemy endpoints, not the public RPC.
4. Record the public web URL in README.

## Task 2 — Faucet (≈1–2 h)
Goal: a judge with an empty wallet can get test tokens in one click.
1. Check the testnet mock tokens (test USDG and mHIMS): is `mint` owner-only?
   - If owner-only: deploy a small `Faucet` contract pre-funded with supply. Do **not** open `mint` publicly.
   - Faucet gives, per address, once per 24 h: 1,000 test USDG + 10 mHIMS (tunable constants).
   - Reverts on a second claim inside 24 h. Owner can refill and pause.
2. Tests: claim works; second claim inside 24 h reverts; pause works; empty faucet reverts cleanly.
3. Deploy to 46630, verify on Blockscout, add address to README and `web/src/config/addresses.46630.json`.
4. Web: "Get test tokens" button on `/app` (and `/sandbox`), with a note that users also need testnet ETH for
   gas + link to the Robinhood testnet faucet.

## Task 3 — Sandbox cycle (≈3–4 h) — the most important task
Goal: a judge sees the whole mechanism work in about two minutes, instead of waiting for a real weekend.

**Deployment:** a separate sandbox deployment on 46630, wired to `ManualSessionClock` (SPEC §3.2):
- its own community vault (mHIMS) and its own MetaVault + MetaVault-only vault, via the existing factory flow;
- its own mock price reference and its own pool, so sandbox actions never touch the live testnet vaults the
  keeper runs honestly on the real clock.

**Controls:** judges can't hold the owner/keeper keys, so buttons go through a server route:
- `POST /api/sandbox/step` with `{ step }` — one of:
  `buyIn` → `startWeekend` (clock on + arm) → `simulateSqueeze` (DemoBuyer pushes pool price up)
  → `reopenMarket` (clock off + fresh price) → `settle` → `unwind`, plus `reset`.
- Server holds a **dedicated sandbox key** with testnet ETH only. The route must:
  - only call an allowlist of functions on an allowlist of **sandbox** addresses (hard-coded);
  - enforce the step order (reject out-of-order steps with a clear message);
  - rate-limit per IP;
  - return tx hashes.
- State is shared between visitors. Show the current phase and who-can-do-what clearly; offer `reset`.

**Page `/sandbox`:**
- Stepper UI: each step has one button, a one-line plain-English explanation, and the Blockscout link of its tx.
- Before/after panel: user's vault shares and their value in STOCK / USDG, so "you ended with more" is visible.
- Two paths shown side by side:
  - Community vault: deposit mHIMS → weekend → squeeze → reopen → settle → withdraw more mHIMS.
  - MetaVault: deposit test USDG → buy-in → weekend → squeeze → reopen → settle → unwind → more USDG.
- Also a "No squeeze" run (skip `simulateSqueeze`) so judges see nothing is lost on the ladder when nothing
  happens, and the MetaVault's honest risk (price moves) is described next to it.

Acceptance: from an empty wallet, faucet → community path → withdraw more than deposited, all in the browser,
in under 3 minutes, with every step linked on Blockscout.

## Task 4 — Reproduce script (≈1 h)
`scripts/demo-cycle.sh`:
- Mode `local`: anvil + deploy + full cycle + prints before/after balances (reuse the existing E2E run).
- Mode `testnet`: runs the sandbox steps against 46630 using the sandbox key from `.env`.
README section "Reproduce in one command" with exact commands and expected output.

## Task 5 — Landing page + README rewrite (≈3 h)
Lead with the problem, not yield. Structure for both:
1. **Problem:** on weekends, new Robinhood stock tokens can spike because nobody can create more supply.
   HIMS +317.6% (29 Aug), GLXY +186.1% (12 Sep) — both new listings with no Chainlink feed; every feed-backed
   ticker stayed under ~4%. Retail buys the top, then gets hit on Monday.
2. **Why it's structural:** token creation depends on the real market being open; tokenization window
   Mon 02:00 – Sat 02:00 CET/CEST. Even if Robinhood extends hours, the weekend gap, holidays and halts remain.
3. **What Offmint does:** the weekend seller. 4-rung sell ladder above Friday's price, capped Monday buyback.
   Tagline: "They price the weekend. We supply it."
4. **Two ways in:**
   - Hold the stock already → community vault (no new exposure; you already held it).
   - Hold dollars → MetaVault (real market risk, stated plainly: 8% pre-weekend stop-loss, 30% allocation cap,
     blacklist; not risk-free).
5. **Proof:** replays (HIMS, GLXY), mainnet-fork simulations, the autonomous testnet cycle (link its txs),
   paper trading on mainnet (link `/paper`), test counts.
6. **Numbers, always together and labeled:** return on the capital actually deployed in a squeeze vs. whole-vault
   return (current cautious settings: +0.44% NAV on a +30% squeeze). Explain that the gap is deliberate risk
   sizing (allocation × deploy caps). Use the exact figures from our own runs; name the source of each.
7. **Honest limits:** small sample (two squeezes), thin pools, our own supply shrinks the spike, not available to
   US persons.
8. **Try it:** links to `/sandbox`, faucet, reproduce script.

Also update README with: contract table + Blockscout links (incl. faucet + sandbox), architecture diagram,
how to run, test commands and counts, risk section.

## Task 6 — Submission materials (≈2 h)
Create in `docs/submission/`:
1. `DEMO_SCRIPT.md` — 3-minute video script, timed:
   0:00–0:30 problem (HIMS chart) · 0:30–1:00 mechanism · 1:00–2:15 live `/sandbox` run on screen
   · 2:15–2:45 proof (replays, testnet autonomous cycle, paper mode) · 2:45–3:00 two ways in + honest risk.
   The user records it; you write the script and a shot list.
2. `DECK.md` — 5 slides: Problem · Why it's structural · Mechanism · Proof · Safety & roadmap.
3. `HACKQUEST.md` — draft answers for the submission form: one-liner, problem, solution, how it uses
   Robinhood Chain/Arbitrum, tech stack, links (repo, live URL, video, contracts), team.
   (The user will check the real form fields and adjust.)
4. `COLOSSEUM.md` — same content adapted, plus a **prior-work disclosure** listing what was built before the
   Colosseum window and for Singapore (Colosseum allows pre-existing code only if disclosed).
5. `QA.md` — prepared answers: "isn't this just LP?", "what if Robinhood allows weekend creation?",
   "what about a Monday gap-up?", "oracle manipulation?", "why would anyone deposit?", "is the keeper AI?".

## Task 7 — Keep collecting evidence (background, no action unless broken)
- Paper mode keeps running on Railway through the weekends of 26–28 Sep and 3–4 Oct.
- After each weekend, append results to `/paper` and to README's evidence section (squeeze or no squeeze —
  report both honestly).

## Order and schedule
| When | Tasks |
|---|---|
| Now | 1 → 2 → 3 |
| Next | 4, then 5 |
| By Fri 2 Oct | 6 drafts done; everything deployed and linked |
| Sat 3 Oct | User records video; final README pass; Oct 3–4 paper weekend running |
| **Sun 4 Oct before 07:59 UTC** | Submit HackQuest (user) |
| 5–11 Oct | Polish from judge-style review; Colosseum materials; decide MetaVault `deployBps` from new weekend data |

## Out of scope before Oct 4
Mainnet deployment · AI advisor (M8) · sponsored gas · tranching · new protocol features · any change to
`OffmintVault`.

## When done with each task
Commit, push, keep CI green, and report: what shipped, addresses/links, anything that deviated from this file.
