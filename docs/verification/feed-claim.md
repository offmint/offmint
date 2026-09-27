# Feed-backed tokens and weekend spikes: reconciling the scans (27 Sep 2026)

**Trigger.** Review flagged LMT ("has a Chainlink feed") at +53.5% held 13.2 h on 5 Sep, against the older claim that
feed-backed tokens stayed under ~4% (from a scan that found every feed token at +3.7% or less).

## Finding 1: LMT has no Chainlink feed
- Chainlink's reference data directory (`feeds-robinhood-mainnet.json`, fetched 27 Sep) lists **35** Robinhood Chain
  stock feeds. LMT isn't among them. Snapshot: `web/public/data/feeds.json`.
- The detector agrees: `contracts/config/basket.json` has LMT with `hasFeed: false`, pool age 20.1 days, TVL ≈ $3.15M
  (a basket member on the push-price path), and `contracts/config/screen.json` (23 Sep) has `hasFeed: false`.
- The "feed-backed" label came from our own `docs/submission/JUDGE_REVIEW.md` note, which was wrong. Corrected there.

## Finding 2: the two scans measured different sets of tokens, on different terms
| | Scan A `contracts/config/tickers.json` | Scan B `contracts/config/tickers-allfeeds.json` | Weekend report `web/public/data/weekends.json` |
|---|---|---|---|
| Tokens | 10 hand-picked: 8 feed majors (AAPL AMZN CRCL INTC NVDA QQQ SPY TSM), USAR (no data), HIMS | all 35 feed tokens | every hook-free USDG pool, fee ≤ 1% (187 tickers) |
| Windows | 8 weekends, 1 Aug to 19 Sep | same 8 | 12 mint-off windows, 3 Jul to 19 Sep |
| Reference | Chainlink Friday close (pool at Fri 20:00 UTC without a feed) | same | official close of the last session (Yahoo) |
| Peak | highest print in the window | same | highest premium **held at least 15 min** |
| LMT | not included | not included (no feed) | +53.48% (5 Sep, 13.2 h above 10%), +14.44% (19 Sep, 1.1 h) |

- "≤ 3.7%" is true only of Scan A's 8 majors (INTC +3.67% is the highest). It was never a statement about all feed
  tokens: Scan B already had MSTR +243.3%, RKLB +35.8%, CRWV +26.1%, ORCL +15.3%, IONQ +14.6%.
- The measures differ on thin pools: CRWV +26.1% (Scan B, a print) vs +1.55% held (report); ORCL +15.3% vs +2.76%
  (a zero-liquidity drain print, see docs/verification/replay-with-supply.md). On the four largest names they agree:
  report max +2.52% (NVDA), Scan B max +2.62% (NVDA).

## The claim now (all copy)
In 12 mint-off windows, a token held more than 10% above its reference for 1 h or more **19 times: 16 on tokens without
a feed** (including LMT +53.5% on 5 Sep) **and 3 on tokens with one** (MSTR on 25 Jul and 29 Aug, RKLB on 12 Sep). The
largest names (NVDA, TSLA, AAPL, SPY) never went above **2.6%**. Computed in `web/src/lib/feedSplit.ts`, pinned by the
test `feed split: spike counts and large-cap ceiling match the weekend report` (web/test/claims.test.ts).

## Flagged, not changed
- `docs/SPEC.md` §3 line 91 ("every other name staying calm (≤11.7%)") and `CLAUDE.md` ("every Chainlink-feed major
  staying calm") predate the full report. The CLAUDE.md line is still true for majors; SPEC's ≤ 11.7% is not true of
  the full 187-ticker report. SPEC is the source of truth, so the wording change is left to the user.
- The detector treats "has a feed" as "graduated" (not a basket member). MSTR and RKLB show that excludes some
  spikes; already flagged in docs/verification/mstr.md §5.
