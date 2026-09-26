# Offmint — assets & data sources (for the landing page and app)

## 1. Our own brand
`web/public/brand/` — Offmint logo, mark, favicon, app icon, BRAND.md (colors, Schibsted Grotesk).
Font via Google Fonts: `Schibsted Grotesk` 400/500/600/700.

## 2. Stock token metadata (names, addresses, logos)
**Source of truth: Robinhood's Stock Token API** — docs: https://docs.robinhood.com/chain/stock-token-apis/
- `GET https://api.robinhood.com/rhj/assets` → per token: `tokenSymbol`, `tokenName`, `deployments[]`
  (`contractAddress`, `chainId` 4663), `currentMultiplier`, `pendingMultiplier`, `logoUrl`, tradability fields.
- `GET https://api.robinhood.com/rhj/prices` → underlying prices (already used by `PushPriceReference` poster).
- Canonical address list (human-readable): https://docs.robinhood.com/chain/contracts/
  A same-ticker token at a different address is NOT a Robinhood Stock Token. Never take addresses from
  third-party token lists.

**Logos — decided: use Robinhood's own token icon for every stock token.**
`logoUrl` from `/rhj/assets` points to Robinhood's CDN, which serves the same Robinhood feather image for every
stock token (confirmed by Trust Wallet's asset PR). That is Robinhood's own chosen image for its Stock Tokens, so
it's the accurate icon to show. Rules:
- Use exactly the image at `logoUrl` from the API. Don't source the feather from anywhere else, don't recolor,
  crop, or combine it with our logo.
- Always show it **next to the ticker badge**. The icon is identical for every token, so the ticker is what tells
  them apart; the icon alone must never be the only identifier.
- If `logoUrl` fails to load, fall back to the ticker badge alone (no broken images).
- Use it only as a token icon. Never in Offmint's own brand elements, hero, or anywhere it could read as Robinhood
  endorsing Offmint. Keep the "not affiliated with or endorsed by Robinhood" footer line.
- Check the rules in the Robinhood Chain brand pack (§3) and follow them if they cover token icons.
→ **Do not** use company logos from logo APIs or websites (wrong-company risk, no official source).

Cache `/rhj/assets` server-side (e.g. revalidate every 10 min). Never call it from the browser on every render.

## 3. Chain & ecosystem logos (only for factual "built on" mentions)
- **Robinhood Chain official brand pack:**
  https://cdn.robinhood.com/robinhood_chain/brand_assets/robinhood-chain-brand-assets-v1.zip
  Use only in a small "Built on Robinhood Chain" line/footer, following the rules inside the pack.
  Never imply Robinhood endorses, partners with, or operates Offmint.
- **Do not** use the main Robinhood app logo (the feather / Robinhood wordmark) anywhere **except** as the token
  icon returned by `/rhj/assets` (§2). For "built on" mentions, the chain pack above is the right asset.
- **Arbitrum official brand kit:** https://arbitrum.io/brand-kit — same rule: factual "Built on Arbitrum" only.
- Add a footer disclaimer: "Offmint is an independent project and is not affiliated with or endorsed by
  Robinhood or the Arbitrum Foundation. Robinhood Stock Tokens are not available to US persons."

## 4. Chart data
Principle: **the landing page must not depend on a third-party API being up during judging.**

| Chart | Source | How |
|---|---|---|
| HIMS weekend (+317.6%) | Our own backtest JSON | Already produced from PoolManager `Swap` logs via Alchemy + reference price. Serve as static JSON from `web/public/backtest/`. |
| GLXY weekend (+186.1%) | Our own backtest JSON | Same. |
| Live basket strip on landing / `/monitor` | Our own detector + paper-mode output, plus onchain reads (pool `slot0` via StateView or `extsload`) and `/rhj/prices` | Already built. Server-side, cached. |
| Autonomous testnet cycle proof | Blockscout testnet (explorer.testnet.chain.robinhood.com) | Link the actual tx hashes; no API needed. |
| Optional: extra pool candles (OHLCV) | GeckoTerminal public API, network id `robinhood` | Free and rate-limited. Use only for optional extras, cache server-side, and show a fallback if it fails. Confirm endpoint paths in GeckoTerminal's API docs before coding. |

Other providers exist (Bitquery, Mobula, GoldRush, DexScreener) but need keys or add dependencies — not needed
for the submission.

**Chart library:** keep **recharts** (already in the stack). One visual language for all charts:
- token price line in Paper/Matte, reference (real share) price as a dashed neutral line,
- the premium gap shaded in Glow cyan — the only cyan on the chart,
- Offmint's sell rungs as horizontal steps above the reference (reuses the logo's staircase idea),
- gains/losses in neutral text, never brand cyan.
Label every chart with its data source and date range.

## 5. Things NOT to use
- No stock photography, no screenshots of Robinhood's app, no Robinhood marketing images.
- No company logos (see §2).
- No live third-party API as a hard dependency of the landing hero.

## 6. Follow-up for after Oct 4 (do not start now)
The contracts page says the canonical table is "generated live from the on-chain asset registry", and a public
Rust crate verifies canonical tokens as EIP-1967 beacon proxies on Robinhood's issuer beacon. That suggests an
**onchain** canonical check may be possible, which would let `VaultFactory` verify tokens itself instead of relying
on owner curation. Investigate after submission; `OffmintVault` stays untouched regardless.