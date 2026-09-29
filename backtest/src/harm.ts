// Harm scan (docs/TAILOR.md Phase 1 item 3): who paid above the reference price while minting was off?
//   npm run harm -w backtest [-- --since 2026-07-01]
// Every Robinhood Chain stock token x every mint-off window since --since (weekends + US market holidays):
// swaps in every hook-free STOCK/USDG pool (fee <= 1%) that BOUGHT the token above the reference price, the unique
// transaction senders behind them, and the USD paid above the reference price. Not "overpaid": the paid price includes
// the pool fee, and a buyer whose stock opened higher on Monday lost nothing.
// Reference = official close of the last US trading session before the window (Yahoo Finance daily chart), the same
// price the tokens track at NAV. A pool whose last pre-window price is > 10% away from the reference is not tracking the
// stock (spam / mispriced pool) and is excluded, and counted as excluded. Writes web/public/data/harm.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toHex, type Hex } from "viem";
import { makeClient, logClient, blockAtOrBefore, POOL_MANAGER, SWAP_TOPIC, isRateLimited, backoff } from "../../keeper/src/chain.js";
import { mintOffWindows } from "./window.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const ZERO = "0x0000000000000000000000000000000000000000";
const THRESHOLDS = [0, 2, 5, 10]; // % above reference; headline > 5% (well beyond the <= 1% pool fee and normal spread), 2% as detail
const HEADLINE = 5;
const SENDERS_FROM = 2; // unique senders are resolved and reported for thresholds >= 2%
const OFF_REF_PCT = 10;
const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "2026-07-01";
const CACHE = join(ROOT, "backtest/.cache/harm");
// wallet lookups go to Alchemy when set (the public node Cloudflare-challenged us under load on 26 Sep, and our live
// services share it); public node otherwise. The URL is never logged (the Alchemy URL contains the key).
const RPC_URLS = [process.env.ALCHEMY_RH_MAINNET_URL || process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com"];
mkdirSync(CACHE, { recursive: true });

const c = makeClient();
const head = Number((await c.getBlock()).timestamp);
const windows = mintOffWindows(Date.parse(`${since}T00:00:00Z`) / 1000, head);
console.error(`${windows.length} mint-off windows since ${since}`);

// ---------------------------------------------------------------- tokens + pools
const reg = (await (await fetch("https://api.robinhood.com/rhj/assets")).json()).assets as any[];
const tokens = new Map<string, string>(); // token -> ticker
for (const a of reg) {
  const d = a.deployments.find((x: any) => x.chainId === 4663);
  if (d) tokens.set(d.contractAddress.toLowerCase(), a.tokenSymbol);
}
const poolCache = JSON.parse(readFileSync(join(ROOT, "backtest/.cache/pools.json"), "utf8")) as Record<string, any[]>;
const pools = new Map<string, { ticker: string; stockIs0: boolean; fee: number }>();
let hookedPools = 0;
for (const [ticker, ps] of Object.entries(poolCache)) {
  for (const p of ps) {
    if (p.quote.toLowerCase() !== USDG) continue;
    if (p.hooks.toLowerCase() !== ZERO) { hookedPools++; continue; }
    if (p.fee > 10_000) continue;
    pools.set(p.poolId.toLowerCase(), { ticker, stockIs0: p.stockIs0, fee: p.fee });
  }
}
const tickers = [...new Set([...pools.values()].map((p) => p.ticker))].sort();
console.error(`${tokens.size} registry tokens; ${pools.size} hook-free USDG pools (fee <= 1%) across ${tickers.length} tickers; ${hookedPools} hooked USDG pools not scanned`);

// ---------------------------------------------------------------- reference closes (Yahoo daily chart, cached)
const closesPath = join(CACHE, `closes-${since}.json`);
const closes: Record<string, Record<string, number> | null> = existsSync(closesPath) ? JSON.parse(readFileSync(closesPath, "utf8")) : {};
// A cached series is reused only if it already reaches the newest window's reference date; otherwise it is refetched
// (it used to be reused forever, so each new window had no reference close and came out empty).
const newestRef = windows.map((w) => w.refDate).sort().at(-1)!;
const covers = (c: Record<string, number> | null) => !!c && Object.keys(c).sort().at(-1)! >= newestRef;
for (const t of tickers) {
  if (covers(closes[t])) continue;
  const cached = closes[t];
  const sym = t.replace(".", "-");
  closes[t] = null; // failures are retried on the next run, never cached
  for (let attempt = 0; attempt < 4 && !closes[t]; attempt++) {
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${Date.parse(`${since}T00:00:00Z`) / 1000 - 10 * 86400}&period2=${head}&interval=1d`, { headers: { "user-agent": "Mozilla/5.0" } });
      if (r.status === 429) throw new Error("rate limited");
      const d = (await r.json()).chart.result?.[0];
      if (!d) break; // unknown symbol
      const q = d.indicators.quote[0].close as (number | null)[];
      closes[t] = Object.fromEntries((d.timestamp as number[]).map((ts, i) => [new Date(ts * 1000).toISOString().slice(0, 10), q[i]]).filter(([, v]) => v !== null));
    } catch {
      await new Promise((r) => setTimeout(r, 5_000 * 2 ** attempt));
    }
  }
  if (!closes[t] && cached) closes[t] = cached; // refetch failed: keep what we had, retry next run
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync(closesPath, JSON.stringify(Object.fromEntries(Object.entries(closes).filter(([, v]) => v))));
const noRef = tickers.filter((t) => !closes[t]);
if (noRef.length) console.error(`no reference close for ${noRef.length} tickers: ${noRef.join(", ")}`);

// ---------------------------------------------------------------- logs (tx hash kept: we need tx.from)
type Log = { poolId: string; block: number; tx: Hex; amount0: bigint; amount1: bigint; sqrtPriceX96: bigint; liquidity: bigint };
async function getLogs(ids: string[], from: bigint, to: bigint): Promise<Log[]> {
  const out: Log[] = [];
  let chunk = 400_000n;
  let limited = 0;
  for (let s = from; s <= to; ) {
    const e = s + chunk - 1n > to ? to : s + chunk - 1n;
    let raw: any[];
    try {
      raw = (await logClient().request({ method: "eth_getLogs", params: [{ address: POOL_MANAGER, fromBlock: toHex(s), toBlock: toHex(e), topics: [SWAP_TOPIC, ids] }] } as any)) as any[];
    } catch (err) {
      if (isRateLimited(err)) {
        await backoff(limited++);
        continue;
      }
      if (chunk <= 1_000n) throw err;
      chunk /= 4n;
      continue;
    }
    limited = 0;
    if (chunk < 400_000n) chunk *= 2n;
    for (const l of raw) {
      const d = l.data.slice(2);
      const word = (i: number) => BigInt("0x" + d.slice(i * 64, i * 64 + 64));
      const signed = (x: bigint) => (x >= 1n << 255n ? x - (1n << 256n) : x);
      out.push({ poolId: l.topics[1].toLowerCase(), block: Number(BigInt(l.blockNumber)), tx: l.transactionHash, amount0: signed(word(0)), amount1: signed(word(1)), sqrtPriceX96: word(2), liquidity: word(3) });
    }
    s = e + 1n;
  }
  return out;
}

const ids = [...pools.keys()];
const BATCH = 500;
const usdOf = (sq: bigint, s0: boolean) => { const s = Number(sq) / 2 ** 96; return s0 ? s * s * 1e12 : 1e12 / (s * s); };
type Agg = { swaps: number; stock: number; usdPaid: number; aboveUsd: number; senders: Set<string>; txs: Set<string> };
const agg = () => Object.fromEntries(THRESHOLDS.map((t) => [t, { swaps: 0, stock: 0, usdPaid: 0, aboveUsd: 0, senders: new Set<string>(), txs: new Set<string>() }])) as Record<number, Agg>;
const perWindow: any[] = [];
const perTicker = new Map<string, { windows: Set<string>; a: Record<number, Agg>; maxPremiumPct: number }>();
const excluded = { offReferencePoolWindows: 0, offReferenceSwaps: 0, noReferenceTickerWindows: 0 };
const txFrom = new Map<string, string>();
const fromPath = join(CACHE, "txfrom.json");
if (existsSync(fromPath)) for (const [k, v] of Object.entries<string>(JSON.parse(readFileSync(fromPath, "utf8")))) txFrom.set(k, v);

for (const w of windows) {
  const cachePath = join(CACHE, `swaps-${w.start}-${w.end}.json`);
  let logs: Log[];
  const pre = w.start - 24 * 3600;
  if (existsSync(cachePath)) {
    logs = (JSON.parse(readFileSync(cachePath, "utf8")) as any[]).map((l) => ({ ...l, amount0: BigInt(l.amount0), amount1: BigInt(l.amount1), sqrtPriceX96: BigInt(l.sqrtPriceX96), liquidity: BigInt(l.liquidity ?? 0) }));
  } else {
    const [b0, b1, b2] = [await blockAtOrBefore(c, pre), await blockAtOrBefore(c, w.start), await blockAtOrBefore(c, w.end)];
    logs = [];
    // no spread push: one batch can exceed the argument limit (29 Aug, the HIMS weekend)
    for (let i = 0; i < ids.length; i += BATCH) for (const l of await getLogs(ids.slice(i, i + BATCH), b0, b2)) logs.push(l);
    for (const l of logs) (l as any).pre = l.block <= Number(b1);
    writeFileSync(cachePath, JSON.stringify(logs, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
  }
  // pool legitimacy: last pre-window price (else the first in-window print) within 10% of the reference
  const firstPx = new Map<string, number>();
  for (const l of logs) {
    const p = pools.get(l.poolId)!;
    if ((l as any).pre || !firstPx.has(l.poolId)) firstPx.set(l.poolId, usdOf(l.sqrtPriceX96, p.stockIs0));
  }
  const W = agg();
  const tick = new Map<string, number>();
  const seenNoRef = new Set<string>();
  const offPools = new Set<string>();
  for (const l of logs) {
    if ((l as any).pre) continue;
    const p = pools.get(l.poolId)!;
    const ref = closes[p.ticker]?.[w.refDate];
    if (!ref) { seenNoRef.add(p.ticker); continue; }
    const px0 = firstPx.get(l.poolId)!;
    if (Math.abs(px0 / ref - 1) * 100 > OFF_REF_PCT) { offPools.add(l.poolId); excluded.offReferenceSwaps++; continue; }
    const [stk, usd] = p.stockIs0 ? [l.amount0, l.amount1] : [l.amount1, l.amount0];
    if (!(stk > 0n && usd < 0n)) continue; // buys only: stock to the trader, USDG in
    const stock = Number(stk) / 1e18, paid = Number(-usd) / 1e6;
    if (stock <= 0 || paid < 0.01) continue;
    const prem = (paid / stock / ref - 1) * 100;
    const T = perTicker.get(p.ticker) ?? perTicker.set(p.ticker, { windows: new Set(), a: agg(), maxPremiumPct: -Infinity }).get(p.ticker)!;
    for (const th of THRESHOLDS) {
      if (prem <= th) continue;
      for (const A of [W[th], T.a[th]]) {
        A.swaps++; A.stock += stock; A.usdPaid += paid; A.aboveUsd += paid - stock * ref; A.txs.add(l.tx);
      }
      if (th === HEADLINE) T.windows.add(w.label);
    }
    T.maxPremiumPct = Math.max(T.maxPremiumPct, prem);
    tick.set(p.ticker, (tick.get(p.ticker) ?? 0) + 1);
  }
  excluded.offReferencePoolWindows += offPools.size;
  excluded.noReferenceTickerWindows += seenNoRef.size;
  // tx.from for the headline set (cached; batched)
  // wallets are reported from the 2% threshold up; resolving every buy a cent above the reference is ~20x the calls
  const need = [...W[SENDERS_FROM].txs].filter((h) => !txFrom.has(h));
  // JSON-RPC batches, one worker per endpoint (public node + Alchemy when set), each backing off on its own rate limit:
  // one lookup per request (~7/s) was far too slow for the 29 Aug window
  const chunks: string[][] = [];
  for (let i = 0; i < need.length; i += 50) chunks.push(need.slice(i, i + 50));
  let next = 0, done = 0;
  const worker = async (url: string) => {
    for (let k = next++; k < chunks.length; k = next++) {
      const chunk = chunks[k];
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(chunk.map((h, id) => ({ jsonrpc: "2.0", id, method: "eth_getTransactionByHash", params: [h] }))) });
          const text = await res.text();
          const body = text.startsWith("[") ? (JSON.parse(text) as any[]) : null; // an HTML challenge page = rate limited
          if (!body) throw Object.assign(new Error("rate limited, challenged or batch refused"), { status: 429 });
          for (const r of body) if (r?.result?.from) txFrom.set(chunk[r.id], String(r.result.from).toLowerCase());
          break;
        } catch (e) {
          if (attempt >= 30) throw e;
          await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
        }
      }
      done += chunk.length;
      if (done % 5000 < 50) {
        writeFileSync(fromPath, JSON.stringify(Object.fromEntries(txFrom)));
        console.error(`  ${w.label}: senders ${done}/${need.length}`);
      }
    }
  };
  await Promise.all(RPC_URLS.map(worker));
  writeFileSync(fromPath, JSON.stringify(Object.fromEntries(txFrom)));
  for (const th of THRESHOLDS) for (const h of W[th].txs) { const f = txFrom.get(h); if (f) W[th].senders.add(f); }
  const row = {
    window: w.label, start: new Date(w.start * 1000).toISOString(), end: new Date(w.end * 1000).toISOString(), hours: (w.end - w.start) / 3600,
    reason: w.reason, referenceClose: w.refDate, swapsScanned: logs.filter((l) => !(l as any).pre).length,
    ...Object.fromEntries(THRESHOLDS.map((th) => [`above${th}pct`, fmt(W[th], th)])),
  };
  perWindow.push(row);
  console.error(`${w.label}: ${row.swapsScanned} swaps; buys >${HEADLINE}% above ref: ${W[HEADLINE].swaps} swaps, ${W[HEADLINE].senders.size} senders, $${Math.round(W[HEADLINE].aboveUsd)} above ref`);
}
for (const T of perTicker.values()) for (const th of THRESHOLDS) for (const h of T.a[th].txs) { const f = txFrom.get(h); if (f) T.a[th].senders.add(f); }

function fmt(a: Agg, th: number) {
  // unresolvedTxs: buys whose sender lookup failed; > 0 means uniqueSenders is an undercount (never silent)
  return { swaps: a.swaps, uniqueSenders: th >= SENDERS_FROM ? a.senders.size : null, unresolvedTxs: th >= SENDERS_FROM ? [...a.txs].filter((h) => !txFrom.has(h)).length : null, stockBought: Math.round(a.stock * 1e4) / 1e4, usdPaid: Math.round(a.usdPaid * 100) / 100, usdAboveReference: Math.round(a.aboveUsd * 100) / 100 };
}
const total = Object.fromEntries(THRESHOLDS.map((th) => {
  const s = new Set<string>();
  for (const T of perTicker.values()) for (const x of T.a[th].senders) s.add(x);
  const sum = (k: keyof Agg) => [...perTicker.values()].reduce((a, T) => a + (T.a[th][k] as number), 0);
  const unresolved = th >= SENDERS_FROM ? [...perTicker.values()].reduce((n, T) => n + [...T.a[th].txs].filter((h) => !txFrom.has(h)).length, 0) : null;
  return [`above${th}pct`, { swaps: sum("swaps"), uniqueSenders: th >= SENDERS_FROM ? s.size : null, unresolvedTxs: unresolved, usdPaid: Math.round(sum("usdPaid") * 100) / 100, usdAboveReference: Math.round(sum("aboveUsd") * 100) / 100, tickers: [...perTicker.values()].filter((T) => T.a[th].swaps > 0).length }];
}));
const byTicker = [...perTicker.entries()]
  .map(([t, T]) => ({ ticker: t, windowsAbove2pct: [...T.windows], maxBuyPremiumPct: Math.round(T.maxPremiumPct * 100) / 100, ...Object.fromEntries(THRESHOLDS.map((th) => [`above${th}pct`, fmt(T.a[th], th)])) }))
  .sort((a: any, b: any) => b[`above${HEADLINE}pct`].usdAboveReference - a[`above${HEADLINE}pct`].usdAboveReference);

const out = {
  generatedAt: new Date().toISOString(),
  label: "observed (onchain swaps, Robinhood Chain mainnet)",
  method: [
    "Mint-off windows: Sat 00:00 to Mon 00:00 UTC (Robinhood tokenization window closed Sat 02:00 to Mon 02:00 CEST), extended over US market holidays.",
    "Reference: official close of the last US trading session before the window (Yahoo Finance daily chart). The token tracks this price at NAV when minting is on.",
    `Scanned: every hook-free STOCK/USDG Uniswap v4 pool with fee <= 1% (${pools.size} pools, ${tickers.length} tickers). ${hookedPools} hooked USDG pools were not scanned (hook accounting can differ from the Swap event).`,
    `A pool is excluded for a window if its last pre-window price is more than ${OFF_REF_PCT}% from the reference (spam or mispriced pool, not tracking the stock).`,
    "A buy = a swap that sent the stock to the trader for USDG. Paid price = USDG in / stock out, including the pool fee (<= 1%).",
    `USD above reference = USDG paid - stock x reference, summed over buys whose paid price exceeded the reference by more than the threshold. Headline threshold: ${HEADLINE}% (above fee + normal spread).`,
    "Unique senders = distinct transaction `from` addresses, counted for buys at least 2% above the reference. Includes bots and aggregators, not only people.",
    "This is USD paid above the reference price, not a loss: it includes the pool fee (<= 1%), and a buyer whose stock opened higher after the window may have lost nothing.",
  ],
  thresholdsPct: THRESHOLDS,
  headlineThresholdPct: HEADLINE,
  windows: perWindow,
  totals: total,
  excluded: { ...excluded, hookedPoolsNotScanned: hookedPools, tickersWithoutReference: noRef },
  byTicker: byTicker.slice(0, 40),
};
const outPath = join(ROOT, "web/public/data/harm.json");
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(total, null, 1));
console.log(`wrote ${outPath}`);
