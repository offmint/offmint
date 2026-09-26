# Judge review — first-time-judge pass (26 Sep 2026)

Read as a judge who opens the README and the site cold, with 5 minutes. Scores are ours, not a prediction.

| Criterion | Score | Why | Evidence a judge can click |
|---|---|---|---|
| Smart contract quality | **8/10** | 160 forge tests incl. fuzz, invariants and both pool orientations; 12 pinned fork tests; stress with 0 violations; Slither triaged; threat model per key and input, incl. the sell order; contracts source-verified. Minus: unaudited; the testnet sandbox needs a ≥ 30 min cycle, so a judge can't run the onchain cycle instantly (the browser sandbox covers it, labelled). | README "Deployed" table, CI runs, docs/verification/slither.md, docs/THREAT_MODEL.md |
| Real problem | **9/10** | HIMS +317.6% on one chart; $3.6M paid above the reference by 23,291 wallets, every swap scanned; minting off 31.2% of the year with Robinhood's own sources. Minus: the sponsor quote (GM) has no source link yet. | `/weekends`, landing hero, README first screen |
| Innovation | **7/10** | Liquidity gated on the tokenization clock + a reference for tokens without feeds + sell orders anchored to the reference. Minus: a judge may read the mechanism as "a limit order" (answered in QA.md and the landing FAQ). | Landing "Four things you can do", FAQ, `/sell` |
| Product-market fit | **6/10** | Clear first user (holders), honest fee model, basket-wide recurrence. Minus: capacity ~$1,647 per pool and ~0% on normal weekends make it a small product today; MetaVault is unproven. | Landing explainer table, README Fees + Roadmap |

## The three weakest points, and what we did
1. **No public URL yet.** A judge who can't click the site scores from the README only.
   → Fixable: deploy (D1, Cloudflare). Until then, the README first screen carries the hero image and live links
   (paper mode JSON, Blockscout, CI). **Needs the user.**
2. **Sponsor quote without a source.** "Robinhood's crypto GM named user-supplied pool depth as the fix" is our
   strongest PMF line and it has no link.
   → Marked `[SOURCE NEEDED]` in HACKQUEST.md and QA.md. **Needs the user:** paste the link, or we delete the line
   before submission. We won't submit it unsourced.
3. **Small numbers.** +3.8% to +7.1% on a spike weekend, ~0% otherwise, capacity ~$1,647 per pool.
   → Can't be fixed by Friday and shouldn't be hidden. Framed as honest size + roadmap (RFQ/aggregator buybacks) in the
   README, deck slide 5 and QA "Why so small?".

## Also noted
- Live pages depend on the public RPC unless an Alchemy key is set (D4); under rate limits the landing shows
  "updating" rather than stale numbers. Set `ALCHEMY_RH_MAINNET_URL` on the web host before judging.
- Sell-order **buy back** is shown after Mon 28 Sep 00:00 UTC (C3 caveat); first live weekend-report row lands the same
  Monday (C2 caveat).
- The weekend report shows LMT (a feed-backed large cap) at +53.5% held for 13.2 h on 5 Sep, with 4,511 swaps and 1,495
  wallets. That's real pool trading, not a data error, and it doesn't contradict the landing (the "stayed within a few
  percent" claim is scoped to NVDA, TSLA, AAPL, SPY). A judge may ask; answer: pool premiums are not limited to
  no-feed tokens, which is why the monitor watches the whole basket.
