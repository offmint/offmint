# Live premiums: INDA +24.96%, ELF +13.18% (AIRTIGHT item 1)

**Verdict: not real premiums. Root cause: the reference price, not the pool.** Fixed with a quality gate; the landing
page now shows only verified premiums.

## What we saw (24 Sep 2026, ~08:00 UTC, a Thursday, US market closed)
| Token | Pool price | Reference used | "Premium" |
|---|---|---|---|
| INDA | $48.04 | $38.44 | +24.96% |
| ELF | $100.45 | $88.75 | +13.18% |

## Investigation
- **Reference quote spread.** The reference is the mid of Robinhood's `/rhj/prices` quote. Off-hours the quote is
  wide: INDA was bid $43.44 / ask $52.03 (18% spread) at 08:41 UTC. The mid of such a quote is not a price; it
  moved from $38.44 to $47.74 within the hour, and the "premium" went from +24.96% to +0.42% with no pool change.
  At the same time 60 of 195 quotes had spreads above 1%.
- **ELF** has the same off-hours swing (reference $88.75 → $95.33) and, in addition, its deepest pool charges a 2.01%
  fee, so the pool legitimately trades a few percent away from the reference.
- **Units / multiplier: correct.** `/rhj/prices` returns raw `bid`/`ask` (underlying share) and `tokenBid`/`tokenAsk`
  (already × `currentMultiplier`). Verified with CRWD (multiplier 4): bid 259.06 → tokenBid 1036.24. The live route
  uses the token fields only, so the multiplier is applied exactly once. INDA and ELF both have multiplier 1.
- **Pool choice.** The Railway detector (fresh run) picked a different INDA pool ($411k TVL) than the local basket
  ($9.6M TVL); both are hook-free USDG pools. The gate below makes the choice visible (TVL, depth, last swap).
- **Pool price: independent check passes.** GeckoTerminal (network `robinhood`, v4 pool id) had ELF at $102.31 vs our
  onchain $100.45 (1.8%).

## Fix: quality gate (`web/src/lib/liveGate.ts`, tests in `web/test/liveGate.test.ts`)
A premium is **verified** only if all pass:
1. pool TVL ≥ $10,000 (detector floor);
2. a $1,000 swap moves the pool < 2% (from the detector's $-to-move-10% depth);
3. last swap in the pool < 6 h ago (onchain Swap logs), else "stale pool";
4. reference quote not halted and bid/ask spread ≤ 1% (the INDA failure mode), multiplier applied once (token fields);
5. pool price within 2% of GeckoTerminal; if GeckoTerminal is unreachable the premium is **unverified**, never verified.

Landing: the stat is "highest verified live premium" ("None" if no token passes) and the live table lists verified
rows only. `/monitor` lists every row with its status and the first failing reason.

## Known limitation
On weekends Robinhood's quote is the frozen close; if its spread is wide the gate marks premiums unverified even when
a real squeeze is happening. The weekend screen (not the live stat) is the evidence for weekend premiums.
