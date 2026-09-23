// M0.5 as a rule, not a list: which stock tokens are in the "new listing, no price feed yet" window right now?
//   npm run detect -w backtest [-- --max-age-days 30]
// For every registry token with a hook-free STOCK/USDG pool (from the M0.5 screen): pool age from its v4 Initialize
// event, Chainlink feed availability, recent activity. Paths:
//   chainlink   -> has a Chainlink feed: eligible for a normal (Chainlink-priced) vault ("graduated")
//   new-listing -> no feed AND pool younger than --max-age-days: the vulnerable window, API-oracle path
//   no-feed     -> no feed, older pool: outside the launch window (still watched by paper mode if active)
// Writes contracts/config/window.json and docs/window.md. Re-run weekly (SPEC §3.5 step 5).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { makeClient, POOL_MANAGER } from "../../keeper/src/chain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as Hex;

export type Path = "chainlink" | "new-listing" | "no-feed";

/** Pure classification (unit-tested). */
export function classifyPath(hasFeed: boolean, poolAgeDays: number | null, maxAgeDays: number): Path {
  if (hasFeed) return "chainlink";
  if (poolAgeDays !== null && poolAgeDays <= maxAgeDays) return "new-listing";
  return "no-feed";
}

async function main() {
  const args = process.argv.slice(2);
  const maxAge = Number(args.includes("--max-age-days") ? args[args.indexOf("--max-age-days") + 1] : 30);
  const screen = JSON.parse(readFileSync(join(ROOT, "contracts/config/screen.json"), "utf8"));
  const c = makeClient();
  const now = Number((await c.getBlock()).timestamp);
  const out: Record<string, any> = {};
  const entries = Object.entries<any>(screen.tickers).filter(([, v]) => v.bestUsdgPool);
  console.log(`detect: ${entries.length} tokens with a hook-free USDG pool, window <= ${maxAge}d`);
  for (const [t, v] of entries) {
    let createdAt: number | null = null;
    try {
      const logs: any[] = await c.request({
        method: "eth_getLogs",
        params: [{ address: POOL_MANAGER, fromBlock: "0x0", toBlock: "latest", topics: [INIT_TOPIC, v.bestUsdgPool] }],
      } as any);
      if (logs[0]) createdAt = Number((await c.getBlock({ blockNumber: BigInt(logs[0].blockNumber) })).timestamp);
    } catch (e) {
      console.log(`${t}: init lookup failed (${String(e).slice(0, 80)})`);
    }
    const ageDays = createdAt ? Math.round(((now - createdAt) / 86_400) * 10) / 10 : null;
    out[t] = {
      path: classifyPath(v.hasFeed, ageDays, maxAge),
      hasFeed: v.hasFeed,
      poolId: v.bestUsdgPool,
      poolCreated: createdAt ? new Date(createdAt * 1000).toISOString() : null,
      poolAgeDays: ageDays,
      recentSwaps: v.swaps7d,
      recentVolumeStock: v.vol7dStock,
      impact50kPct: v.impact50kPct,
    };
    process.stdout.write(".");
  }
  console.log();
  const by = (p: Path) => Object.entries<any>(out).filter(([, v]) => v.path === p);
  const doc = {
    generatedAt: new Date().toISOString(),
    rule: `new-listing = no Chainlink feed AND deepest hook-free USDG pool created <= ${maxAge} days ago`,
    maxAgeDays: maxAge,
    counts: { chainlink: by("chainlink").length, newListing: by("new-listing").length, noFeed: by("no-feed").length },
    newListings: by("new-listing").sort((a, b) => b[1].recentSwaps - a[1].recentSwaps).map(([t]) => t),
    tokens: out,
  };
  writeFileSync(join(ROOT, "contracts/config/window.json"), JSON.stringify(doc, null, 1) + "\n");
  const rows = by("new-listing")
    .sort((a, b) => b[1].recentSwaps - a[1].recentSwaps)
    .map(([t, v]) => `| ${t} | ${v.poolCreated?.slice(0, 10) ?? "?"} | ${v.poolAgeDays}d | ${v.recentSwaps} | ${v.impact50kPct}% |`)
    .join("\n");
  writeFileSync(
    join(ROOT, "docs/window.md"),
    `# New-listing window (detector)\n\nRule: ${doc.rule}. Generated ${doc.generatedAt}.\n\n` +
      `Paths: **${doc.counts.chainlink}** chainlink (graduated), **${doc.counts.newListing}** new-listing (API-oracle path), **${doc.counts.noFeed}** no-feed (older).\n\n` +
      `| Token | USDG pool created | Age | Swaps (last 1d) | $50k impact |\n|---|---|---|---|---|\n${rows}\n`,
  );
  console.log(JSON.stringify(doc.counts), "new listings:", doc.newListings.slice(0, 25).join(", "));
  console.log("wrote contracts/config/window.json and docs/window.md");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
