// Read-only mainnet dry run of the PushPriceReference poster (docs/AIRTIGHT.md item 8). No transactions, no keys.
// For every basket ticker: what the poster would post (or why it would skip). For every ticker with a Chainlink feed:
// our API-derived token price vs the Chainlink answer, to measure the error of the poster's method.
//   npx tsx src/posterDryRun.ts [--out logs/poster-dryrun.jsonl]
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAbi, type Address } from "viem";
import { makeClient } from "./chain.js";
import { toTokenPriceE8, spreadBps, MAX_SPREAD_BPS } from "./apiOracle.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const feedAbi = parseAbi(["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)", "function decimals() view returns (uint8)"]);
const out = resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : join(ROOT, "keeper/logs/poster-dryrun.jsonl"));
mkdirSync(dirname(out), { recursive: true });

const [assets, prices] = await Promise.all([
  fetch("https://api.robinhood.com/rhj/assets").then((r) => r.json()),
  fetch("https://api.robinhood.com/rhj/prices").then((r) => r.json()),
]);
const asset = new Map<string, any>((assets.assets as any[]).map((a) => [a.tokenSymbol, a]));
const quote = new Map<string, any>((prices.quotes as any[]).map((q) => [q.tokenSymbol, q]));
const basket = JSON.parse(readFileSync(process.env.BASKET_PATH ?? join(ROOT, "contracts/config/basket.json"), "utf8")).members as { ticker: string }[];
const feeds = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8")).stocks as Record<string, { feed?: string }>;
const c = makeClient();
const ts = new Date().toISOString();
const rows: any[] = [];

for (const { ticker } of basket) {
  const a = asset.get(ticker), q = quote.get(ticker);
  if (!a || !q) { rows.push({ ts, kind: "poster", ticker, action: "skip: no asset/quote" }); continue; }
  const sp = spreadBps(q.bid, q.ask);
  const priceE8 = toTokenPriceE8({ kind: "api-raw", bid: q.bid, ask: q.ask, multiplier: a.currentMultiplier });
  rows.push({ ts, kind: "poster", ticker, bid: q.bid, ask: q.ask, multiplier: a.currentMultiplier, spreadBps: Math.round(sp), halted: !!q.isTradingHalt,
    wouldPost: sp <= MAX_SPREAD_BPS ? Number(priceE8) / 1e8 : null, action: sp <= MAX_SPREAD_BPS ? "would post" : "would skip: wide quote" });
}
for (const [ticker, s] of Object.entries(feeds)) {
  if (!s.feed) continue;
  const a = asset.get(ticker), q = quote.get(ticker);
  if (!a || !q) continue;
  try {
    const [, answer, , updatedAt] = await c.readContract({ address: s.feed as Address, abi: feedAbi, functionName: "latestRoundData" });
    const dec = await c.readContract({ address: s.feed as Address, abi: feedAbi, functionName: "decimals" });
    const cl = Number(answer) / 10 ** dec;
    const ours = Number(toTokenPriceE8({ kind: "api-raw", bid: q.bid, ask: q.ask, multiplier: a.currentMultiplier })) / 1e8;
    rows.push({ ts, kind: "vs-chainlink", ticker, ours, chainlink: cl, errorPct: +((ours / cl - 1) * 100).toFixed(3), spreadBps: Math.round(spreadBps(q.bid, q.ask)),
      feedAgeMin: Math.round((Date.now() / 1000 - Number(updatedAt)) / 60), multiplier: a.currentMultiplier });
  } catch (e) {
    rows.push({ ts, kind: "vs-chainlink", ticker, error: String(e).slice(0, 80) });
  }
}
for (const r of rows) appendFileSync(out, JSON.stringify(r) + "\n");
const cmp = rows.filter((r) => r.kind === "vs-chainlink" && r.errorPct !== undefined);
const tight = cmp.filter((r) => r.spreadBps <= MAX_SPREAD_BPS);
const abs = (xs: any[]) => xs.map((r) => Math.abs(r.errorPct)).sort((x, y) => x - y);
const med = (xs: number[]) => (xs.length ? xs[Math.floor(xs.length / 2)] : null);
console.log(JSON.stringify({
  ts, poster: { tickers: rows.filter((r) => r.kind === "poster").length, wouldPost: rows.filter((r) => r.action === "would post").length, wouldSkip: rows.filter((r) => String(r.action).includes("skip")).length },
  vsChainlink: { compared: cmp.length, medianAbsErrPct: med(abs(cmp)), maxAbsErrPct: abs(cmp).at(-1) ?? null, tightQuotes: tight.length, medianAbsErrPctTight: med(abs(tight)), maxAbsErrPctTight: abs(tight).at(-1) ?? null },
}));
