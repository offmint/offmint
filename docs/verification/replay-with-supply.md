# With-supply replay (AIRTIGHT item 7, TAILOR Phase 1 item 2)

**Status: done, 26 Sep 2026.** Output `web/public/data/supply/replay.json` (label: simulated). Code:
`backtest/src/supply.ts` (runner), `keeper/src/poolSim.ts` + `keeper/src/supplyReplay.ts` (engine, 12 tests).

## Method
- Universe: the weekend screen (`web/public/data/screen/weekends.json`, 45 tickers x 8 weekends, 1 Aug – 19 Sep):
  198 ticker-weekends with data. The 16 with a logged peak >= +5% are replayed in full; below that the first
  rung (+8%) cannot fill, so the 182 others are no-fill weekends.
- Each pool is **rebuilt from its full onchain ModifyLiquidity history** (from creation), then every logged swap's input
  is re-run through it with the contract's default ladder added (rungs +8–12%, +15–22%, +25–35%, +40–55%,
  30% of the holding), armed Sat 00:05 UTC above p0 (the screen's reference).
- Vault rules as in the contract: a rung is pulled when fully sold; every rung is pulled 15 min before reopen; one
  buyback at Mon 01:00 UTC capped at fresh x 1.01; unfilled USDG stays pending and is **valued at the cap incl. the pool
  fee** (the worst price a retry may pay); 10% performance fee on the marked gain; $1 gas per armed weekend.
- **raw** = rungs marked along the logged path (assumes we move nothing, the old engine's assumption). **supply** = our
  liquidity in the pool. Headline = supply, **excluding LP fee income** (fee income shown separately).
- Before the buyback the rebuilt pool is resynced to the logged Monday price (minting is back on). While none of our
  orders is in play, the rebuilt pool follows the logged price exactly; it departs from history only while our orders
  absorb flow.

## Validation
A base-only copy of the rebuilt pool re-runs the same inputs and must reproduce every logged price: max error per event
in the last column (<= 0.0007%). Bugs found and fixed on the way: float drift in patchy pools (AMC), float dust at the
last tick and a rounding leftover jumping an empty range (GLXY 13 Sep), a buyback limit already behind the price (MSTR:
the pool was still above the cap on Monday).

## Results (per holding size; % of the holding; supply = with our orders, ex-LP-fees, after the fee)
| Event | Logged peak | raw $1k | supply $1k | supply $10k | supply $100k | state $10k | buyback before cap ($100k) | swaps | shadow err |
|---|---|---|---|---|---|---|---|---|---|
| HIMS 2026-08-29 | +317.56% | +3.85% | +3.81% | +3.67% | +3.60% | PENDING_BUYBACK | $1,647 | 8,306 | 0% |
| MSTR 2026-08-29 | +243.31% | +6.25% | +6.24% | +6.32% | +6.34% | PENDING_BUYBACK | $0 | 62,891 | 0.0003% |
| GLXY 2026-09-12 | +186.09% | +7.07% | +7.05% | +7.03% | +6.85% | OPEN | $5,198 | 17,277 | 0.0007% |
| RKLB 2026-09-12 | +35.83% | +4.05% | +4.02% | +2.06% | +1.92% | OPEN | $3,152 | 2,103 | 0% |
| CRWV 2026-08-29 | +26.14% | +1.93% | -0.10% | -0.01% | -0.00% | OPEN | – | 215 | 0% |
| ORCL 2026-08-29 | +15.25% | +5.79% | +1.28% | +3.25% | +5.30% | PENDING_BUYBACK | $32 | 182 | 0% |
| IONQ 2026-09-19 | +14.56% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 14 | 0% |
| NU 2026-09-12 | +11.74% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 5,479 | 0.0003% |
| BULL 2026-09-05 | +7.86% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 12,617 | 0.0002% |
| RGTI 2026-09-05 | +7.8% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 6 | 0% |
| AMD 2026-08-01 | +7.72% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 278 | 0% |
| AMC 2026-09-05 | +7.5% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 44,848 | 0.0003% |
| EWY 2026-09-12 | +7.32% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 194 | 0% |
| SLV 2026-09-12 | +6.33% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 1 | 0% |
| RKLB 2026-09-05 | +6.31% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 1,571 | 0% |
| HIMS 2026-09-05 | +5.09% | -0.10% | -0.10% | -0.01% | -0.00% | OPEN | – | 12,377 | 0.0001% |

Totals ($10k per ticker-weekend): raw $2,937.33, supply ex-LP-fees $2,220.89, USDG still pending
$8,137.42. Non-zero events: 7.

## What it means
- Big spikes (HIMS, GLXY, MSTR) earn +3.6% to +7.1% of the holding; the result barely falls with size **in %**, but only
  because most of the extra USDG is **pending**: the Monday pool can't supply the tokens within the 1% cap.
- **Capacity** is the binding limit: USDG bought back before the cap ranged from $0 (MSTR: the pool was still above the
  cap) to $5,198 (GLXY); median $1,647 (HIMS).
- Our supply can remove the opportunity: CRWV 29 Aug peaked +26% logged, +8.7% with our orders at $10k, leaving ~0.
- Worst replayed weekend: about −0.1%, almost entirely gas. No weekend in the sample opened high enough on Monday to
  cause a real trading loss; the stress test (synthetic) shows −0.49% on such a weekend, and the sandbox's "Monday opens
  higher" case shows how a larger loss happens.
- Assumption to keep in mind: traders send the same input they sent historically. Real buyers facing a smaller spike
  might buy more or less.
- ORCL 29 Aug: the with-supply "peak" (+53% at $10k) exceeds the logged peak (+15%) because the logged peak excludes a
  zero-liquidity drain print; our ladder absorbed that swap inside its top rung, where liquidity is not zero.
