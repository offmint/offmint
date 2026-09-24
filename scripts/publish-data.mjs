// Publishes every number the website shows into web/public/data/*.json, from its source artifact.
// Components read only these files (docs/AIRTIGHT.md ground rule 1); web/test/claims.test.ts checks them.
//   node scripts/publish-data.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = (p, obj) => {
  const f = join(root, "web/public/data", p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
  console.log(`web/public/data/${p}`);
};
const read = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

// 1. Weekend screen evidence (backtest/src/curate.ts). The cache is local; the published copy is the source of record.
const cacheDir = join(root, "backtest/.cache");
if (existsSync(cacheDir)) {
  const files = readdirSync(cacheDir).filter((f) => /^evidence-\d+-\d+\.json$/.test(f)).sort();
  const merged = {};
  for (const f of files) for (const [t, ws] of Object.entries(read(`backtest/.cache/${f}`))) {
    merged[t] ??= {};
    for (const w of ws) merged[t][w.weekend] = w; // later files (re-runs) override earlier ones
  }
  out("screen/weekends.json", {
    source: "backtest/src/curate.ts: every swap on each ticker's deepest hook-free STOCK/USDG Uniswap v4 pool, Robinhood Chain mainnet",
    reference: "p0 = Chainlink close before Sat 00:00 UTC where a feed exists (p0Source 'chainlink'); otherwise the pool price at Fri 20:00 UTC ('pool-fri-close')",
    tickers: Object.fromEntries(Object.entries(merged).map(([t, ws]) => [t, Object.values(ws).sort((a, b) => a.weekend.localeCompare(b.weekend))])),
  });
}

// 2. The live testnet MetaVault cycle
out("testnet/demo-meta.json", { ...read("contracts/deployments/demo-meta-46630.json"), chainId: 46630, explorer: "https://explorer.testnet.chain.robinhood.com" });

// 3. Protocol parameters, parsed from the contract source so the site cannot drift from the code
const meta = readFileSync(join(root, "contracts/src/MetaVault.sol"), "utf8");
const rm = readFileSync(join(root, "contracts/src/libraries/RangeMath.sol"), "utf8");
const op = readFileSync(join(root, "contracts/src/libraries/OffmintParams.sol"), "utf8");
const num = (src, key) => Number(src.match(new RegExp(`${key}:\\s*(\\d+)`))[1]);
out("params.json", {
  source: "contracts/src (MetaVault.defaultParams, RangeMath.defaultLadder, OffmintParams.defaults)",
  metaVault: Object.fromEntries(["maxConcurrent", "allocBps", "earlyUnwindThresholdBps", "weeklyLossCapBps", "txFeeBps", "blacklistDays"].map((k) => [k, num(meta, k)])),
  vault: Object.fromEntries(["defaultDeployBps", "buybackSlippageBps", "perfFeeBps"].map((k) => [k, num(op, k)])),
  ladder: [...rm.matchAll(/r\[\d\] = Rung\((\d+), (\d+), (\d+)\);/g)].map((m) => ({ premiumBps: +m[1], widthBps: +m[2], shareBps: +m[3] })),
});

// 4. Test counts (from the last full local run; CI re-checks the forge count)
if (existsSync(join(root, "web/public/data/tests.json"))) console.log("web/public/data/tests.json (kept; updated by CI check)");
