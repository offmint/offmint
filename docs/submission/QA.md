# Offmint — judge Q&A

Short, honest answers. Numbers from docs/CLAIMS.md.

**Isn't this just a Uniswap limit order?**
Mechanically, yes: a one-sided range above the price is a limit order. The product is *where* (anchored to the
verified reference, refused if the pool is already there), *when* (only while minting is off, found by the session
clock), *which tokens* (a detector over new listings without a Chainlink feed), and the capped Monday buyback that turns
sold tokens back into more tokens. The sell order page lets anyone place the plain version themselves, for free.

**Why so small?**
The Monday buyback must stay within 1% of the fresh price, and today's pools are shallow: about $1,647 per pool
(median of 5 capped weekends in our replay; range $0 to $5,198). Bigger buyback routes (RFQ, aggregators) are the next
step on the roadmap. We would rather show the real capacity than a big APY.

**Does it calm the spike?**
Not at current size. On a thin pool our orders can cut the peak (CRWV 29 Aug: +26% → +9%), but on the big squeezes they
barely dent it. We don't claim to fix the market.

**Can depositors lose?**
Yes. If Monday opens higher than where we sold, the capped buyback can't get everything back; the rest waits and retries,
and after 48 h the vault can end mixed (stock + USDG). The stress test saw −0.49% on one weekend; the worst replayed
weekend was −0.1%.

**Is it market-neutral?**
For a holder, the vault adds no *new* exposure: they already held the token. It isn't risk-free: selling above Friday's
price and failing to buy back on a gap-up is a real outcome.

**Why not a fixed list of tickers?**
Squeezes recur across the basket, not per ticker: HIMS and GLXY spiked on different weekends; a fixed list would have
caught one by luck. The detector rebuilds the basket every 6 hours.

**What stops the keeper from stealing?**
Nothing to steal with: the keeper can only arm with a ladder at least as conservative as the default, lock, and settle
within the caps. Owner and keeper can never receive funds (invariant-tested). If the keeper stops, anyone can arm or
settle after a grace period.

**Is it an AI agent?**
No. The keeper is a rules-based bot: threshold checks against a price reference.

**Where does the price for tokens without a Chainlink feed come from?**
Robinhood's own quote × multiplier (applied once), posted by a separate key with forward-only timestamps and a 20% cap per
post. The owner can freeze it.

**Robinhood is adding market makers. Doesn't that kill this?**
It narrows the window, and that's good for users. Weekends, holidays and halts remain, and new listings arrive thin.
Robinhood's own fix names users supplying stock tokens into pools, which is what the vault does [SOURCE NEEDED].

**What about MetaVault?**
Experimental, coming later. Its weekly picker, replayed with only the data it would have had, did not pick HIMS.

**Audited?**
No. Unaudited, testnet only. Slither triage and a threat model are in the repo.
