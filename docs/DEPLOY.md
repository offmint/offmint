# Deploying the web app (Cloudflare Workers, built from GitHub)

The web app (`web/`) runs on Cloudflare Workers through the OpenNext adapter (`@opennextjs/cloudflare`). Cloudflare
Workers Builds watches `offmint/offmint` on GitHub: every push to `main` builds and deploys; other branches get preview
URLs. No Cloudflare token lives in GitHub. Worker config: `web/wrangler.jsonc`.

**Plan:** Workers Paid. The gzipped Worker is ~3.7 MiB; the free plan's limit is 3 MiB.

## One-time setup (Cloudflare dashboard)
1. **Workers & Pages → Create → Import a repository.** Authorise the Cloudflare GitHub app for the `offmint`
   organisation, repository `offmint/offmint` only.
2. Build settings:

   | Setting | Value |
   |---|---|
   | Project (Worker) name | `offmint-web` (must equal `name` in `web/wrangler.jsonc`) |
   | Production branch | `main` |
   | Root directory | `web` |
   | Build command | `npx opennextjs-cloudflare build` |
   | Deploy command | `npx opennextjs-cloudflare deploy` |
   | Non-production branch deploy command | `npx opennextjs-cloudflare upload` |

3. **Build variables** (Settings → Build → Variables and secrets; read at build time):

   | Name | Value |
   |---|---|
   | `NODE_VERSION` | `22` |
   | `NEXT_PUBLIC_SITE_URL` | the Worker's public URL, e.g. `https://offmint-web.<subdomain>.workers.dev` (share-card links) |
   | `NEXT_PUBLIC_WC_PROJECT_ID` | optional: a WalletConnect/Reown project ID; without it the site offers browser-extension wallets only |

4. **Runtime variables** (Settings → Variables and secrets; read by the server routes at request time):
   `ALCHEMY_RH_MAINNET_URL`, `ALCHEMY_RH_TESTNET_URL`: optional. **Removed 30 Sep** (both keys had used up their monthly
   capacity, HTTP 429): the site runs on the public RPC. Pool prices and last swaps come from the paper service's
   `/last-swaps.json` (its own IP; the public RPC sometimes refuses Cloudflare's shared IPs), with an onchain read as the
   fallback. `wrangler.jsonc` has `keep_vars: true`, so a terminal deploy keeps any dashboard variables.

   **Deploying from the terminal** (Workers Builds did not pick up the 29 Sep pushes):
   `cd web && CLOUDFLARE_API_TOKEN=… NEXT_PUBLIC_SITE_URL=https://offmint-web.offmintfinance.workers.dev npm run cf:deploy`.
   The token is an account API token with Workers edit rights; never commit it.
5. The first deploy happens on save. After it, copy the workers.dev URL into `NEXT_PUBLIC_SITE_URL` and retry the
   build once (Deployments → Retry build) so share cards carry the right absolute URL.

## After each deploy
`cd web && E2E_URL=https://<url> node scripts/deploy-check.mjs`: every route at 1440 and 390 px, live data on
`/monitor` and `/weekends`, wallet connect (read-only test wallet), and the per-visitor `/api/rpc` rate. Results go to
`docs/screenshots/D1/deploy-check.json`.

## What protects the Alchemy key
`/api/rpc` forwards read-only JSON-RPC methods only, at most 50 calls per request, and is rate-limited per IP to 120
requests per minute (Workers Rate Limiting binding `RPC_LIMITER`; `web/src/lib/rateLimit.ts`). The browser batches its
reads, so one visitor sends about 12 requests a minute.

## Live data that doesn't come from the Worker
Cloudflare's egress IPs are shared, so the public Robinhood RPC and GeckoTerminal answer the Worker with 429, and
Alchemy's free tier allows only 10-block `eth_getLogs`. The paper service on Railway (its own IP) therefore scans the
basket pools' last swaps every 2 min and fetches GeckoTerminal prices every 5 min, served at
`https://offmint-keeper-production.up.railway.app/last-swaps.json` (`keeper/src/lastSwaps.ts`). `/api/live` uses it
when fresh (last swaps < 10 min, prices < 15 min old) and falls back to scanning itself otherwise (local dev).
`/api/live` reports which in `lastSwapSource`.

## Local
`cd web && npm run cf:preview` builds and serves the Worker locally in workerd (http://localhost:8787).
