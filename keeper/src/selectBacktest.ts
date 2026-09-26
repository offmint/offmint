// Point-in-time validation of SELECT (docs/AIRTIGHT.md item 9). For each Thursday 12:00 UTC before a screened weekend:
// rebuild the basket as it was (registry tokens, no Chainlink feed, first USDG pool <= 30 days old at that time),
// score it with select.ts using ONLY swaps before that Thursday, then measure each candidate's actual weekend
// (max pool premium Sat 00:00 -> Mon 00:00 over the pool price at Fri 20:00 UTC). Read-only mainnet.
//   npx tsx src/selectBacktest.ts [--from 2026-07-30 --to 2026-09-17] -> keeper/logs/select-backtest.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { makeClient, logClient, blockAtOrBefore, swapLogs, POOL_MANAGER, isRateLimited, backoff, type Client } from "./chain.js";
import { volumeStats, select, SELECT_DEFAULTS, type PoolVolume } from "./select.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const INIT = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as Hex;
const DAY = 86_400;
const opt = (k: string, d: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const topicOf = (a: string) => `0x${a.toLowerCase().slice(2).padStart(64, "0")}` as Hex;

async function getLogsSplit(c: Client, topics: (Hex | Hex[] | null)[], from: bigint, to: bigint, attempt = 0): Promise<any[]> {
  try {
    return (await logClient().request({ method: "eth_getLogs", params: [{ address: POOL_MANAGER, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }] } as any)) as any[];
  } catch (e) {
    if (isRateLimited(e)) {
      await backoff(attempt);
      return getLogsSplit(c, topics, from, to, attempt + 1);
    }
    if (to - from < 1000n) throw e;
    const mid = (from + to) / 2n;
    return [...(await getLogsSplit(c, topics, from, mid)), ...(await getLogsSplit(c, topics, mid + 1n, to))];
  }
}
const usdOf = (sqrt: bigint, stockIs0: boolean) => { const s = Number(sqrt) / 2 ** 96; const p = s * s; return stockIs0 ? p * 1e12 : 1e12 / p; };

const c = makeClient();
const [registry, feeds] = await Promise.all([
  fetch("https://api.robinhood.com/rhj/assets").then((r) => r.json()),
  fetch("https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json").then((r) => r.json()),
]);
const tickerOf = new Map<string, string>();
for (const a of registry.assets as any[]) {
  const d = a.deployments.find((x: any) => x.chainId === 4663);
  if (d) tickerOf.set(d.contractAddress.toLowerCase(), a.tokenSymbol);
}
const fed = new Set((feeds as any[]).filter((f) => String(f.name).startsWith("Robinhood ")).map((f) => String(f.name).split(" ")[1].split(/[-/]/)[0].trim()));
const cache = JSON.parse(readFileSync(join(ROOT, "contracts/config/.detector-cache.json"), "utf8")) as { pools: Record<string, { poolId: string; stockIs0: boolean; createdAt: number }[]> };

const thursdays: number[] = [];
for (let t = Date.parse(`${opt("--from", "2026-07-30")}T12:00:00Z`) / 1000; t <= Date.parse(`${opt("--to", "2026-09-17")}T12:00:00Z`) / 1000; t += 7 * DAY) thursdays.push(t);

const weeks: any[] = [];
for (const T of thursdays) {
  const sat = T + 36 * 3600, fri20 = sat - 4 * 3600, mon = sat + 2 * DAY;
  // basket as of T
  const cands = [...tickerOf.entries()].filter(([tok, sym]) => {
    if (fed.has(sym)) return false;
    const usdgPools = (cache.pools[tok] ?? []).filter((p) => p.createdAt > 0 && p.createdAt <= T);
    const first = Math.min(...usdgPools.map((p) => p.createdAt));
    return usdgPools.length > 0 && T - first <= 30 * DAY;
  });
  const [bFrom, bT, bFri, bMon] = [await blockAtOrBefore(c, T - 14 * DAY), await blockAtOrBefore(c, T), await blockAtOrBefore(c, fri20), await blockAtOrBefore(c, mon)];
  // all pools (any quote) of the candidates created before T
  const toks = cands.map(([t]) => t);
  const pools: { token: string; poolId: Hex; quote: string; stockIs0: boolean; block: bigint }[] = [];
  for (let i = 0; i < toks.length; i += 40) {
    const tp = toks.slice(i, i + 40).map(topicOf);
    for (const pos of [2, 3]) {
      const topics: (Hex | Hex[] | null)[] = [INIT, null, null, null];
      topics[pos] = tp;
      for (const l of await getLogsSplit(c, topics, bFrom - 3_000_000n > 0n ? bFrom - 3_000_000n : 0n, bT)) {
        const c0 = ("0x" + l.topics[2].slice(26)).toLowerCase(), c1 = ("0x" + l.topics[3].slice(26)).toLowerCase();
        const s0 = toks.includes(c0);
        pools.push({ token: s0 ? c0 : c1, poolId: l.topics[1], quote: s0 ? c1 : c0, stockIs0: s0, block: BigInt(l.blockNumber) });
      }
    }
  }
  const progress = (m: string) => console.error(`[${new Date().toISOString().slice(11, 19)}] ${new Date(T * 1000).toISOString().slice(0, 10)} ${m}`);
  progress(`basket ${cands.length}, pools ${pools.length}`);
  // swaps in the 14 days before T (score) and over the weekend (outcome)
  const byId = new Map(pools.map((p) => [p.poolId.toLowerCase(), p]));
  const ids = [...byId.keys()] as Hex[];
  const pre = new Map<string, PoolVolume[]>();
  const wk = new Map<string, { t: number; usd: number; pool: string }[]>();
  // Filtered passes only: an unfiltered PoolManager scan is ~3 swaps/block (tens of GB over the window) and never
  // finished. The public RPC accepts up to 500 pool ids per filter; run a few batches in parallel.
  const BATCH = 500, PARALLEL = 2;
  const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, i * BATCH + BATCH));
  const take = (l: Awaited<ReturnType<typeof swapLogs>>[number]) => {
    const p = byId.get(l.poolId.toLowerCase());
    if (!p) return;
    if (l.ts <= T) {
      const list = pre.get(p.token) ?? (pre.set(p.token, []), pre.get(p.token)!);
      let pv = list.find((x) => x.poolId === p.poolId);
      if (!pv) list.push((pv = { poolId: p.poolId, quote: p.quote, createdAt: 0, swaps: [] }));
      pv.swaps.push({ ts: l.ts, stock: Math.abs(Number(p.stockIs0 ? l.amount0 : l.amount1)) / 1e18 });
    }
    if (p.quote === USDG && l.ts >= fri20 - 6 * 3600 && l.ts <= mon && l.liquidity > 0n) {
      const arr = wk.get(p.token) ?? (wk.set(p.token, []), wk.get(p.token)!);
      arr.push({ t: l.ts, usd: usdOf(l.sqrtPriceX96, p.stockIs0), pool: p.poolId });
    }
  };
  let done = 0, seen = 0;
  for (let i = 0; i < batches.length; i += PARALLEL) {
    const got = await Promise.all(batches.slice(i, i + PARALLEL).map((b) => swapLogs(c, b, bFrom, bMon)));
    // consume per batch (a batch can hold far more swaps than a spread push allows, and memory stays bounded)
    for (const g of got) for (const l of g) take(l), seen++;
    done += got.length;
    progress(`swaps ${done}/${batches.length} batches, ${seen} swaps, rss ${Math.round(process.memoryUsage().rss / 2 ** 20)} MB`);
  }
  for (const list of pre.values()) for (const pv of list) pv.createdAt = Math.min(...pv.swaps.map((s) => s.ts), T);
  const stats = cands.map(([tok, sym]) => volumeStats(sym, tok, pre.get(tok) ?? [], T));
  const res = select(stats, SELECT_DEFAULTS);
  // outcome: busiest USDG pool over the weekend, premium vs its price at Fri 20:00
  const outcome = Object.fromEntries(cands.map(([tok, sym]) => {
    const sw = wk.get(tok) ?? [];
    const busiest = [...new Set(sw.map((s) => s.pool))].map((p) => [p, sw.filter((s) => s.pool === p).length] as const).sort((a, b) => b[1] - a[1])[0]?.[0];
    const ps = sw.filter((s) => s.pool === busiest).sort((a, b) => a.t - b.t);
    const ref = ps.filter((s) => s.t <= fri20).at(-1)?.usd;
    const inWin = ps.filter((s) => s.t >= sat && s.t < mon);
    const maxPct = ref && inWin.length ? Math.round((Math.max(...inWin.map((s) => s.usd)) / ref - 1) * 1e4) / 100 : null;
    return [sym, { maxPremiumPct: maxPct, weekendSwaps: inWin.length }];
  }));
  const squeezed = Object.entries(outcome).filter(([, o]) => (o.maxPremiumPct ?? 0) >= 15).map(([s]) => s);
  const week = {
    thursday: new Date(T * 1000).toISOString().slice(0, 10), weekend: new Date(sat * 1000).toISOString().slice(0, 10),
    basket: cands.length, picks: res.picks.map((p) => p.ticker), squeezed,
    hits: res.picks.filter((p) => squeezed.includes(p.ticker)).map((p) => p.ticker),
    falsePicks: res.picks.filter((p) => !squeezed.includes(p.ticker)).map((p) => p.ticker),
    missed: squeezed.filter((s) => !res.picks.some((p) => p.ticker === s)),
    top: res.scored.slice(0, 6).map((s) => ({ t: s.ticker, score: s.score, growth: s.growthPct, share: s.topNonUsdgSharePct, days: s.windowDays })),
    outcome,
  };
  weeks.push(week);
  console.log(JSON.stringify({ thursday: week.thursday, basket: week.basket, picks: week.picks, squeezed: week.squeezed, hits: week.hits, missed: week.missed }));
}
const outPath = process.env.SELECT_BT_OUT ?? join(ROOT, "keeper/logs/select-backtest.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), config: SELECT_DEFAULTS, squeezeThresholdPct: 15, weeks }, null, 2));
console.log(`wrote ${outPath}`);
