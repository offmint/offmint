# Offmint — deck (5 slides)

Numbers from docs/CLAIMS.md. One idea per slide.

## 1. They price the weekend. We supply it.
- New Robinhood stock tokens can only be minted while the real market is open.
- Visual: the HIMS weekend chart, **+317.6%** over Friday's reference (29 Aug 2026).
- Footer: Unaudited · Robinhood Chain testnet · offmint (repo link).

## 2. The problem is structural and it recurs
- Minting off **31.2% of 2026** (2,736 of 8,760 h).
- **$3,615,154 paid above the reference** by **23,291 wallets** in 12 windows since 1 Jul.
- Different token each time (HIMS, GLXY, MSTR…): >10% held 1 h+ in **4 of 11** windows, but only 3.6% of token-weekends.
- Visual: weekend-report bars per window.

## 3. Session-gated liquidity
- Supply that exists only while minting is off, only above the reference price.
- Friday: four one-sided range orders (+8–12%, +15–22%, +25–35%, +40–55%). Monday: buy back ≤ fresh price + 1%.
- Visual: the ladder staircase over the price line.

## 4. Four features, one story
- See it (**Monitor**) → learn (**Weekend report**) → act yourself (**Sell order**) → or let the vault do it (**Vault**).
- Live on testnet with real wallets: sell order filled 100%; vault 150 → 159.604 mHIMS (simulated squeeze).
- 160 contract tests · 12 fork tests · 0 invariant violations in 40 stress weekends · contracts source-verified.

## 5. Honest size, clear path
- Per $1,000 (simulated): big spike +3.8% to +7.1%, normal weekend ~0%, worst −0.1%. Capacity ≈ $1,647 per pool today.
- It can lose: a Monday gap-up can leave you with fewer tokens.
- Roadmap: audit → capped mainnet → RFQ/aggregator buybacks → launchpad pool supply → other issuers.
