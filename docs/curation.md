# Ticker curation (M0.5, SPEC §3.5)

**Ship for v1: none.** ONLY 0 shippable dislocation-prone ticker(s) found (SPEC asks for 3-5). Not padded: see docs/curation.md.

Generated 2026-09-23T19:38:08.760Z from real Uniswap v4 swap logs on Robinhood Chain mainnet (deepest hook-free STOCK/USDG pool
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
| INTC | **major** | yes |  | 0/8 | +3.67% | +1.63% | 0% | $70,502.5 | max weekend premium +3.7% (< 5%): near-zero fills expected |
| QQQ | **major** | yes |  | 0/8 | +2.83% | +0.6% | 0% | $56 | max weekend premium +2.8% (< 5%): near-zero fills expected |
| NVDA | **major** | yes |  | 0/8 | +2.62% | +0.9% | 0% | $487,536.5 | max weekend premium +2.6% (< 5%): near-zero fills expected |
| AAPL | **major** | yes |  | 0/8 | +1.42% | +0.44% | 0% | $263,412.5 | max weekend premium +1.4% (< 5%): near-zero fills expected |
| CRCL | **major** | yes |  | 0/8 | +1.33% | +1.17% | 0% | $37,657 | max weekend premium +1.3% (< 5%): near-zero fills expected |
| SPY | **major** | yes |  | 0/8 | +1.28% | +0.38% | 0% | $13,997,152.5 | max weekend premium +1.3% (< 5%): near-zero fills expected |
| AMZN | **major** | yes |  | 0/8 | +1.04% | +0.86% | 0% | $4,363 | max weekend premium +0.9% (< 5%): near-zero fills expected |
| TSM | **major** | yes |  | 0/8 | +0.8% | +0.21% | 0% | $231,753 | max weekend premium +0.8% (< 5%): near-zero fills expected |
| USAR | **ineligible** | yes |  | 0/8 | +0% | +–% | –% | $0 | no usable weekend data (pool too inactive) |
