# MSTR: +243% weekend / −100% simulated vault (AIRTIGHT item 2)

**Verdict: the premium is real; the −100% was an engine bug, already fixed, in a stale cached result.**
MSTR stays in the published data, now with the corrected simulation. Correction to our narrative: a ticker **with a
Chainlink feed** squeezed.

## 1. Is the +243% real? Yes.
Pool price (median of swaps in a 30-min window, deepest hook-free MSTR/USDG pool
`0x319bac87…87cfe`, stock = currency1) vs the Chainlink MSTR/USD feed `0x3961…edc3D`:

| Time (UTC) | Pool median | Chainlink | Premium |
|---|---|---|---|
| Thu 27 Aug 16:00 | $138.24 | $138.28 | −0.0% |
| Fri 28 Aug 18:00 | $127.39 | $127.26 | +0.1% |
| Sat 29 Aug 00:00 | $128.75 | $127.81 | +0.7% |
| Sat 29 Aug 12:00 | $160.40 | $127.81 | +25.5% |
| Sun 30 Aug 12:00 | $259.51 | $127.81 | +103.0% |
| Mon 31 Aug 00:00 | $224.60 | $128.13 | +75.3% |
| Mon 31 Aug 16:00 | $130.16 | $130.40 | −0.2% |
| Tue 1 Sep 16:00 | $127.46 | $126.36 | +0.9% |

The pool is at parity before and after; units, decimals, orientation and multiplier (1.0, no pending change) are
correct. The gap opens only while minting is off and closes after reopen: a genuine weekend squeeze.
Script: `docs/verification/mstr-probe.mts` (read-only mainnet logs).

**The +243.31% itself is a traded level, not a stray print** (added 27 Sep; every swap Sat 00:00 to Mon 00:00 UTC,
hour by hour vs the Chainlink close $127.81; `docs/verification/mstr-hourly.mts`, output `mstr-hourly.log`):
62,317 swaps with liquidity (the weekend report counts the same 62,317). The +243.31% print is in the hour from
Sun 30 Aug 14:00, where **390 swaps** traded above +200% and the hour's median was +171.4%; 3,846 swaps traded above
+150% over the weekend. Hourly medians were above +25% from Sat 09:00 to the end of the window. The top was brief: no
level above +166.5% held for 15 minutes, which is why the weekend report (peak = held ≥ 15 min) shows **+166.51%**.
Both numbers are right for what they measure: +243.3% = highest traded price; +166.5% = highest held 15 min.

## 2. Why −100%? Engine bug, fixed, stale cache.
The screen's cached run had `note: "buyback capped: would end PENDING_BUYBACK"`. The engine version that produced it
valued the USDG held after a capped buyback at zero, so a vault that had sold at a premium and was waiting to buy
back scored −100%. The fix (pending USDG marked to market at the fresh price) was already in `keeper/src/engine.ts`
with a regression test (`keeper/test/engine.test.ts`: "pending USDG is marked to market, not valued at zero").
The cached screen result simply predated the fix.

## 3. Re-run and impact
- Re-ran the screen for MSTR (29 Aug – 19 Sep) with the fixed engine:
  **29 Aug: simulated vault vs hold = +32.91% (was −100%)**, max premium unchanged at +243.31%.
- Checked every other cached result affected by the same code path (16 with a capped buyback): all other 15 sold
  nothing that weekend (premium below the ladder), so their 0% was already correct. No other number changed.
- Published site numbers never used the vault column, so no site number came from the bug.

## 4. What changed on the site
- MSTR is now a bar in the comparison ("has a Chainlink feed · 29 Aug", +243.3%).
- Removed the claim "feed-backed names stay calm". New wording: new listings without a feed spiked on two
  weekends; MSTR, which has a feed, spiked the same weekend as HIMS; the largest names stayed within a few percent.

## 5. Product implication (not changed, flagged)
The detector's rule "has a Chainlink feed → graduated, majors don't squeeze" would have excluded MSTR. The basket
rule may be too narrow; revisit with more weekends of data before changing it.
