# Offmint threat model (AIRTIGHT item 11)

Unaudited. Testnet only. This document states what each key and each external input can and cannot do, and what
limits the damage if it misbehaves. Enforcement lives in the contracts; tests named in brackets.

## Keys

| Key | Can | Cannot | If compromised |
|---|---|---|---|
| **Keeper** (bot) | `arm` with a ladder at least as conservative as the default; `lock`; `settle` / `retryBuyback` with a `minStockOut`; MetaVault `buyIn`, `commit`, `unwind` (keeper abort of an uncommitted position) | Withdraw or transfer vault funds; sell below P0 × (1 + first-rung premium); deploy more than `defaultDeployBps`; buy back above fresh price × (1 + `buybackSlippageBps`); buy in above reference × (1 + `buyInSlippageBps`); pick a blacklisted ticker; change parameters | Worst case: arms poorly timed ladders (still above Friday's price) or buys in at up to +1% over the reference and aborts at −1%, repeatedly. Bounded by the caps; owner rotates the keeper. [OffmintVault.t.sol keeper/conservative tests, MetaVault.t.sol buyIn rules, invariant owner/keeper balance] |
| **Poster** (PushPriceReference) | Post a price + observedAt for no-feed tickers | Post backwards in time; move the price > 20% per post unless ≥ 12 h since the last post; post while the owner freeze is on; post if it is the keeper key (enforced in the poster service and factory: poster ≠ keeper) | Can walk the reference up to 20% per post. Arm needs a frozen, recent close; settle needs a fresh print; buyback cap is price × 1.01. Owner freeze stops reads and posts. [PriceReference.t.sol] |
| **Owner** | Set parameters within hard bounds; set keeper; pause deposits; set the default ladder while OPEN; refOwner freezes the push reference; factory owner lists canonical stocks and deploys vaults | Move depositor funds; set any parameter outside its bound; change the fee recipient (immutable); change deployed vault code (factory code hash is pinned) | Can make the product worse within bounds (e.g. pause deposits, freeze a reference). Cannot steal. [paramBounds tests, invariant] |
| **Fee recipient** | Receive the performance fee (10% of realized STOCK profit) and MetaVault's 0.5% entry/exit fee | Anything else | — |

## Inputs

| Threat | Mitigation |
|---|---|
| **Oracle manipulation (Chainlink)** | `answer > 0`, issuer `oraclePaused()`, L2 sequencer uptime + grace (when a sequencer feed exists), staleness rules per state (arm: frozen ≥ 15 min and close within 6 h; settle: printed after reopen and ≤ 1 h old). [sequencer, paused, stale tests] |
| **Oracle manipulation (push reference)** | Separate poster key, forward-only timestamps, 20% per-post cap, halt flag, owner freeze. The reference is Robinhood's quote × multiplier, applied once. |
| **Pool price manipulation / sandwich at settle or buy-in** | Every swap carries a `sqrtPriceLimitX96` at the cap computed from the reference, not the pool; a manipulated pool can only cause a partial fill, never a worse price (LP fee on top). Buy-in also has a pre-check. [settle sandwich test, buy-in sandwich tests] |
| **Monday gap-up** | Buyback capped at fresh price × 1.01; the rest waits in PENDING_BUYBACK and retries; after 48 h `expireBuyback` → OPEN_MIXED (pro-rata STOCK + USDG). This is the covered-call trade-off: a vault can end with fewer shares. [gap-up test; stress test saw −0.49% on one weekend] |
| **Stale prices** | Settle refuses a print older than `maxFreshAge` or from before reopen; MetaVault refuses references older than `maxRefAge`; the landing page only shows premiums that pass a quality gate (docs/verification/premiums.md). |
| **Corporate actions / multiplier jumps** | Chainlink stock feeds include the multiplier; the push path applies `currentMultiplier` exactly once (tested with CRWD, multiplier 4); keeper skips a weekend with a scheduled multiplier change; stop-loss refuses while the reference is paused/halted. |
| **Hooked or fake pools / copycat tokens** | Vaults accept hook-free pools only; the factory deploys only for owner-listed canonical Robinhood token addresses (from Robinhood's registry), never by ticker. |
| **First-depositor inflation** | ERC-4626 decimals offset (3 on OffmintVault, 6 on MetaVault). [inflation test] |
| **Keeper stops** | Anyone can `arm` after `armGrace` and `settle` after `settleGrace`; `emergencyUnwind` after 96 h. |
| **MetaVault market risk** | Not a bug: MetaVault holds volatile stock for days. Bounded by the 8% pre-weekend stop-loss, 30% max per pick, 28-day blacklist after a > 10% loss. It can lose money. |

## Out of scope / known gaps
- No external audit. Slither triage: docs/verification/slither.md.
- The push reference trusts Robinhood's API as the price source.
- The factory's canonical list is owner-curated (an onchain registry check is a follow-up).
