# Ticker curation (M0.5, SPEC §3.5)

**Ship for v1: none.** ONLY 0 shippable dislocation-prone ticker(s) found (SPEC asks for 3-5). Not padded: see docs/curation.md.

Generated 2026-09-23T20:40:17.234Z from real Uniswap v4 swap logs on Robinhood Chain mainnet (deepest hook-free STOCK/USDG pool
per ticker) and Chainlink feed history. Weekends: 2026-08-01 .. 2026-09-19 (8). Candidates come from the
registry-wide screen in `contracts/config/screen.json` (thin = $50k swap moves the USDG pool > 5%, memecoin-adjacent =
a non-USDG pool in the top-2 by 7-day volume), plus majors as controls.

**Buckets:** *dislocation-prone* = > +15% over P0 (Friday Chainlink close) on >= 2 weekends.
*major* = never above +5%: near-zero fills, which is correct behaviour. *neither* = in between. Weekends with
< 5 swaps are ignored. **Shippable** additionally needs a Chainlink feed (vault oracle checks).
Vault column: simulated epoch, about $10,000 deployed, default single band P0 x 1.10..1.60,
lock variant, ex-LP-fees, compounded over the sample. Hypothetical: it assumes the vault does not move the price.

| Ticker | Bucket | Feed | Ship | > +15% weekends | Max premium | Median max | Vault cum. vs HODL (ex-fees) | Median depth to +10% | Reason |
|---|---|---|---|---|---|---|---|---|---|
| HIMS | **neither** | no |  | 1/8 | +317.56% | +0.84% | 18.5711% | $132,723 | max +317.6%, 1 weekend(s) > +15% (needs >= 2) |
| GLXY | **neither** | no |  | 1/8 | +186.09% | +93.15% | 31.5941% | $87,699 | max +186.1%, 1 weekend(s) > +15% (needs >= 2) |
| NU | **neither** | no |  | 0/8 | +11.74% | +0.24% | 0% | $49,094 | max +11.7%, 0 weekend(s) > +15% (needs >= 2) |
| BULL | **neither** | no |  | 0/8 | +7.86% | +2.7% | 0% | $94,257 | max +7.9%, 0 weekend(s) > +15% (needs >= 2) |
| AMC | **neither** | no |  | 0/8 | +7.5% | +0.91% | 0% | $791,448 | max +7.5%, 0 weekend(s) > +15% (needs >= 2) |
| BB | **major** | no |  | 0/8 | +2.28% | +0.86% | 0% | $50,456 | max weekend premium +2.3% (< 5%): near-zero fills expected |
| FIG | **major** | no |  | 0/8 | +1.59% | +1.31% | 0% | $25,471 | max weekend premium +1.6% (< 5%): near-zero fills expected |
| IBM | **major** | no |  | 0/8 | +1.5% | +1.11% | 0% | $42,773 | max weekend premium +1.5% (< 5%): near-zero fills expected |
| RIVN | **major** | no |  | 0/8 | +0.45% | +0.17% | 0% | $46,791.5 | max weekend premium +0.5% (< 5%): near-zero fills expected |
| RCAT | **major** | no |  | 0/8 | +0.19% | +0.14% | 0% | $64,713.5 | max weekend premium +0.2% (< 5%): near-zero fills expected |
