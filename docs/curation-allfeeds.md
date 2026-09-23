# Ticker curation (M0.5, SPEC §3.5)

**Ship for v1: none.** ONLY 0 shippable dislocation-prone ticker(s) found (SPEC asks for 3-5). Not padded: see docs/curation.md.

Generated 2026-09-23T22:01:48.622Z from real Uniswap v4 swap logs on Robinhood Chain mainnet (deepest hook-free STOCK/USDG pool
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
| MSTR | **neither** | yes |  | 1/8 | +243.31% | +4.01% | -100% | $399,431.5 | max +243.3%, 1 weekend(s) > +15% (needs >= 2) |
| RKLB | **neither** | yes |  | 1/8 | +35.83% | +6.31% | 0% | $36,160 | max +35.8%, 1 weekend(s) > +15% (needs >= 2) |
| CRWV | **neither** | yes |  | 1/8 | +26.14% | +2.2% | 0% | $1,479 | max +26.1%, 1 weekend(s) > +15% (needs >= 2) |
| ORCL | **neither** | yes |  | 1/8 | +15.25% | +1.89% | 28.4328% | $7,692 | max +15.3%, 1 weekend(s) > +15% (needs >= 2) |
| IONQ | **neither** | yes |  | 0/8 | +14.56% | +14.56% | 0% | $241 | max +14.6%, 0 weekend(s) > +15% (needs >= 2) |
| RGTI | **neither** | yes |  | 0/8 | +7.8% | +3.92% | 0% | $158 | max +7.8%, 0 weekend(s) > +15% (needs >= 2) |
| AMD | **neither** | yes |  | 0/8 | +7.72% | +0.53% | 0% | $21,422 | max +7.7%, 0 weekend(s) > +15% (needs >= 2) |
| EWY | **neither** | yes |  | 0/8 | +7.32% | +2.74% | 0% | $11,741 | max +7.3%, 0 weekend(s) > +15% (needs >= 2) |
| SPCX | **major** | yes |  | 0/8 | +3.91% | +0.33% | 0% | $672,872.5 | max weekend premium +3.9% (< 5%): near-zero fills expected |
| INTC | **major** | yes |  | 0/8 | +3.67% | +1.63% | 0% | $70,502.5 | max weekend premium +3.7% (< 5%): near-zero fills expected |
| USO | **major** | yes |  | 0/8 | +3.31% | +2.32% | 0% | $56,135.5 | max weekend premium +3.3% (< 5%): near-zero fills expected |
| SNDK | **major** | yes |  | 0/8 | +3.02% | +0.88% | 0% | $71,902 | max weekend premium +3.0% (< 5%): near-zero fills expected |
| QQQ | **major** | yes |  | 0/8 | +2.83% | +0.6% | 0% | $56 | max weekend premium +2.8% (< 5%): near-zero fills expected |
| NVDA | **major** | yes |  | 0/8 | +2.62% | +0.9% | 0% | $487,536.5 | max weekend premium +2.6% (< 5%): near-zero fills expected |
| COIN | **major** | yes |  | 0/8 | +2.31% | +1.04% | 0% | $30,381 | max weekend premium +2.3% (< 5%): near-zero fills expected |
| PLTR | **major** | yes |  | 0/8 | +1.9% | +1.28% | 0% | $74,343 | max weekend premium +1.9% (< 5%): near-zero fills expected |
| GME | **major** | yes |  | 0/8 | +1.73% | +-1.8% | 0% | $2,531.5 | max weekend premium +1.7% (< 5%): near-zero fills expected |
| META | **major** | yes |  | 0/8 | +1.69% | +0.69% | 0% | $34,109.5 | max weekend premium +1.7% (< 5%): near-zero fills expected |
| TSLA | **major** | yes |  | 0/8 | +1.52% | +0.95% | 0% | $187,336 | max weekend premium +1.5% (< 5%): near-zero fills expected |
| AAPL | **major** | yes |  | 0/8 | +1.42% | +0.44% | 0% | $263,412.5 | max weekend premium +1.4% (< 5%): near-zero fills expected |
| CRCL | **major** | yes |  | 0/8 | +1.33% | +1.17% | 0% | $37,657 | max weekend premium +1.3% (< 5%): near-zero fills expected |
| SPY | **major** | yes |  | 0/8 | +1.28% | +0.38% | 0% | $13,997,152.5 | max weekend premium +1.3% (< 5%): near-zero fills expected |
| BABA | **major** | yes |  | 0/8 | +1.21% | +1.11% | 0% | $21,624 | max weekend premium +1.2% (< 5%): near-zero fills expected |
| AMZN | **major** | yes |  | 0/8 | +1.04% | +0.86% | 0% | $4,363 | max weekend premium +0.9% (< 5%): near-zero fills expected |
| GOOGL | **major** | yes |  | 0/8 | +1.03% | +0.59% | 0% | $141,750 | max weekend premium +1.0% (< 5%): near-zero fills expected |
| MSFT | **major** | yes |  | 0/8 | +1.02% | +0.5% | 0% | $92,698 | max weekend premium +1.0% (< 5%): near-zero fills expected |
| NBIS | **major** | yes |  | 0/8 | +0.9% | +0.41% | 0% | $30,711.5 | max weekend premium +0.9% (< 5%): near-zero fills expected |
| TSM | **major** | yes |  | 0/8 | +0.8% | +0.21% | 0% | $231,753 | max weekend premium +0.8% (< 5%): near-zero fills expected |
| DELL | **major** | yes |  | 0/8 | +0.74% | +0.2% | 0% | $20,467 | max weekend premium +0.7% (< 5%): near-zero fills expected |
| ASML | **major** | yes |  | 0/8 | +0.48% | +0.46% | 0% | $1,246 | max weekend premium +0.5% (< 5%): near-zero fills expected |
| SGOV | **major** | yes |  | 0/8 | +0.39% | +-0.05% | 0% | $829,138 | max weekend premium +0.4% (< 5%): near-zero fills expected |
| SLV | **ineligible** | yes |  | 0/8 | +6.33% | +-0.26% | 0% | $0 | no usable weekend data (pool too inactive) |
| CLSK | **ineligible** | yes |  | 0/8 | +0% | +-2.33% | 0% | $89 | no usable weekend data (pool too inactive) |
| MU | **ineligible** | yes |  | 0/8 | +0% | +–% | –% | $0 | no usable weekend data (pool too inactive) |
| USAR | **ineligible** | yes |  | 0/8 | +0% | +–% | –% | $0 | no usable weekend data (pool too inactive) |
