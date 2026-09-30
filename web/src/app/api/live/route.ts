// Live basket data for the landing page and /monitor, computed server-side and cached for 60 s:
// basket membership from the detector (paper service), pool prices and last swaps read onchain (mainnet), reference
// prices from Robinhood's Stock Token API (token-adjusted fields), an independent pool price from GeckoTerminal.
// Every premium goes through the quality gate (src/lib/liveGate.ts); only verified ones reach the landing page.
import { NextResponse } from "next/server";
import { createPublicClient, encodeAbiParameters, fallback, http, keccak256, parseAbi, type Hex } from "viem";
import { gate, tokenRef, type GateResult } from "@/lib/liveGate";

const PAPER_API = process.env.NEXT_PUBLIC_PAPER_API || "https://offmint-keeper-production.up.railway.app";
// Read per call, not at module load: on Cloudflare the secrets reach process.env with the request.
const publicRpcUrl = () => process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
// Alchemy first when set, the public RPC if Alchemy fails (e.g. 429 when the plan's monthly capacity runs out)
const readTransport = () => {
  const pub = http(publicRpcUrl(), { timeout: 15_000 });
  const alchemy = process.env.ALCHEMY_RH_MAINNET_URL;
  return alchemy ? fallback([http(alchemy, { timeout: 15_000, retryCount: 0 }), pub]) : pub;
};
// Alchemy's free tier limits eth_getLogs to 10 blocks: log scans use the public RPC
const logsRpcUrl = publicRpcUrl;
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f" as Hex;
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);

export interface LiveRow extends GateResult {
  ticker: string; token: string; poolId: string; poolUsd: number | null; independentUsd: number | null;
  lastSwapAgeSec: number | null; depthUsdTo10: number; tvlUsd: number; poolAgeDays: number;
}
export interface Live {
  ok: boolean; updatedAt: string; rpc: "alchemy" | "public";
  /** where the last-swap ages (quality gate) came from */
  lastSwapSource: "paper-service" | "direct-scan" | null;
  basket: { live: boolean; generatedAt: string | null; count: number | null };
  rows: LiveRow[]; maxVerified: { ticker: string; pct: number } | null; verifiedCount: number; errors: string[];
}

let cache: { at: number; body: Live } | null = null;
let lastGood: { at: number; body: Live } | null = null;
let gecko: { at: number; prices: Map<string, number> } | null = null;

async function geckoPrices(poolIds: string[], errors: string[]): Promise<Map<string, number>> {
  if (gecko && Date.now() - gecko.at < 5 * 60_000) return gecko.prices;
  const prices = new Map<string, number>();
  for (let i = 0; i < poolIds.length; i += 30) {
    try {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${poolIds.slice(i, i + 30).join(",")}`, {
        cache: "no-store", signal: AbortSignal.timeout(10_000), headers: { accept: "application/json" },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      for (const p of (await r.json()).data ?? []) {
        const a = p.attributes;
        // price of the stock token in USDG: whichever side is not USDG
        const stockIsBase = !/USDG/i.test(String(a.name ?? "").split("/")[0] ?? "");
        const px = Number(stockIsBase ? a.base_token_price_quote_token : a.quote_token_price_base_token);
        if (px > 0) prices.set(String(a.address).toLowerCase(), px);
      }
    } catch (e) {
      errors.push(`geckoterminal: ${String(e).slice(0, 60)}`);
    }
  }
  gecko = { at: Date.now(), prices };
  return prices;
}

async function build(): Promise<Live> {
  const errors: string[] = [];
  let basket: any = null;
  try {
    const r = await fetch(`${PAPER_API}/basket.json`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`basket HTTP ${r.status}`);
    basket = await r.json();
  } catch (e) {
    errors.push(`basket: ${String(e).slice(0, 80)}`);
  }
  const members: any[] = basket?.members ?? [];
  const quotes = new Map<string, ReturnType<typeof tokenRef>>();
  try {
    const r = await fetch("https://api.robinhood.com/rhj/prices", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    for (const q of (await r.json()).quotes ?? []) quotes.set(String(q.tokenSymbol), tokenRef(q));
  } catch (e) {
    errors.push(`prices: ${String(e).slice(0, 80)}`);
  }
  const pool = new Map<string, number>();
  const lastSwap = new Map<string, number>();
  let nowTs = Math.floor(Date.now() / 1000);
  let lastSwapSource: Live["lastSwapSource"] = null;
  let paperIndependent: Map<string, number> | null = null; // GeckoTerminal prices fetched by the paper service
  if (members.length) {
    const c = createPublicClient({ transport: readTransport() });
    const usdOf = (m: any, sqrtX96: bigint) => {
      const sqrt = Number(sqrtX96) / 2 ** 96;
      const p = sqrt * sqrt; // currency1 raw per currency0 raw
      return p > 0 ? (m.pool.stockIsCurrency0 ? p * 1e12 : 1e12 / p) : null; // 18-dec stock vs 6-dec USDG
    };
    // First choice for pool prices and last swaps: the paper service (keeper/src/lastSwaps.ts), refreshed every 2 min
    // from its own IP. On Cloudflare the public RPC sometimes refuses the shared egress IPs, and Alchemy's free tier
    // allows 10-block log queries. Fallback: read here.
    try {
      const r = await fetch(`${PAPER_API}/last-swaps.json`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      const ls = r.ok ? await r.json() : null;
      const indAt = ls?.independent?.updatedAt;
      if (indAt && Date.now() - Date.parse(indAt) < 15 * 60_000) {
        paperIndependent = new Map(Object.entries(ls.independent.prices as Record<string, number>));
      }
      if (ls?.updatedAt && Date.now() - Date.parse(ls.updatedAt) < 10 * 60_000) {
        nowTs = Math.floor(Date.now() / 1000); // chain timestamps track wall-clock time; no RPC call needed
        for (const m of members) {
          const id = String(m.pool.poolId).toLowerCase();
          const ts = ls.pools?.[id];
          if (ts) lastSwap.set(m.token, Math.max(0, nowTs - ts));
          const sq = ls.sqrtPriceX96?.[id];
          const usd = sq ? usdOf(m, BigInt(sq)) : null;
          if (usd) pool.set(m.token, usd);
        }
        lastSwapSource = "paper-service";
      }
    } catch {
      // fall through to reading the chain here
    }
    const unpriced = members.filter((m) => !pool.has(m.token));
    if (unpriced.length) try {
      const slot = (id: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
      // One eth_call for all of them (batchSize 0: no chunking), retried on failure. With viem's default 1 KB chunks, a
      // refused chunk marked its pools as failed silently and the page showed "no pool price".
      const read = () => c.multicall({
        contracts: unpriced.map((m) => ({ address: PM, abi: pmAbi, functionName: "extsload" as const, args: [slot(m.pool.poolId)] as const })),
        allowFailure: true,
        batchSize: 0,
        multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
      });
      let res = await read();
      for (let attempt = 1; attempt < 3 && res.some((x) => x.status !== "success"); attempt++) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        res = await read();
      }
      const failed = res.filter((x) => x.status !== "success").length;
      if (failed) errors.push(`pools: ${failed} of ${members.length} pool reads failed`);
      unpriced.forEach((m, i) => {
        if (res[i].status !== "success") return;
        const usd = usdOf(m, BigInt(res[i].result as Hex) & ((1n << 160n) - 1n));
        if (usd) pool.set(m.token, usd);
      });
    } catch (e) {
      errors.push(`pools: ${String(e).slice(0, 80)}`);
    }
    if (!lastSwapSource) try {
      // last swap per pool within the last 6 h (estimate the block rate from the chain itself)
      const latest = await c.getBlock();
      const back = await c.getBlock({ blockNumber: latest.number - 100_000n });
      nowTs = Number(latest.timestamp);
      const perSec = 100_000 / Math.max(1, Number(latest.timestamp - back.timestamp));
      const span = BigInt(Math.ceil(6 * 3600 * perSec * 1.05));
      const ids = members.map((m) => m.pool.poolId as Hex);
      const byId = new Map(members.map((m) => [String(m.pool.poolId).toLowerCase(), m.token]));
      // adaptive range: halve on RPC errors (public endpoint limits), like keeper/src/chain.ts swapLogs
      const lc = createPublicClient({ transport: http(logsRpcUrl(), { timeout: 20_000, retryCount: 2 }) });
      let chunk = 50_000n;
      for (let from = latest.number - span; from <= latest.number; ) {
        const to = from + chunk - 1n > latest.number ? latest.number : from + chunk - 1n;
        let logs: any[];
        try {
          logs = (await lc.request({
            method: "eth_getLogs",
            params: [{ address: PM, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: [SWAP_TOPIC, ids] }],
          } as any)) as any[];
        } catch (e) {
          if (chunk <= 2_000n) throw e;
          chunk /= 4n;
          continue;
        }
        for (const l of logs) lastSwap.set(byId.get(String(l.topics[1]).toLowerCase())!, Number(BigInt(l.blockNumber)));
        from = to + 1n;
      }
      // convert last-swap blocks to ages
      for (const [tok, b] of lastSwap) lastSwap.set(tok, Math.max(0, (Number(latest.number) - b) / perSec));
      lastSwapSource = "direct-scan";
    } catch (e) {
      errors.push(`last swaps: ${String(e).slice(0, 80)}`);
    }
  }
  // independent price: the paper service's GeckoTerminal fetch first (GeckoTerminal rate-limits Cloudflare's shared IPs)
  const ind = paperIndependent ?? (members.length ? await geckoPrices(members.map((m) => String(m.pool.poolId)), errors) : new Map());
  const rows: LiveRow[] = members.map((m) => {
    const poolUsd = pool.get(m.token) ?? null;
    const independentUsd = ind.get(String(m.pool.poolId).toLowerCase()) ?? null;
    const lastSwapAgeSec = lastSwap.has(m.token) ? lastSwap.get(m.token)! : null;
    const g = gate({ poolUsd, tvlUsd: m.tvlUsd, depthUsdTo10: m.depthUsdTo10, lastSwapAgeSec, ref: quotes.get(m.ticker) ?? null, independentUsd });
    return { ...g, ticker: m.ticker, token: m.token, poolId: m.pool.poolId, poolUsd, independentUsd, lastSwapAgeSec, depthUsdTo10: m.depthUsdTo10, tvlUsd: m.tvlUsd, poolAgeDays: m.poolAgeDays };
  });
  const verified = rows.filter((r) => r.verified && r.premiumPct !== null).sort((a, b) => b.premiumPct! - a.premiumPct!);
  return {
    ok: errors.length === 0,
    updatedAt: new Date(nowTs * 1000).toISOString(),
    rpc: process.env.ALCHEMY_RH_MAINNET_URL ? "alchemy" : "public",
    lastSwapSource,
    basket: { live: !!basket, generatedAt: basket?.generatedAt ?? null, count: basket ? members.length : null },
    rows,
    maxVerified: verified[0] ? { ticker: verified[0].ticker, pct: verified[0].premiumPct! } : null,
    verifiedCount: verified.length,
    errors,
  };
}

export async function GET() {
  // A failed read (ok false or pool reads failed: the public RPC sometimes refuses Cloudflare's shared IPs) is kept for
  // 10 s only, and while it lasts visitors get the last good result (up to 15 min old; its updatedAt says when).
  const bad = (b: Live) => !b.ok || b.errors.some((e) => e.startsWith("pools:"));
  const ttl = cache && bad(cache.body) ? 10_000 : 60_000;
  if (!cache || Date.now() - cache.at > ttl) {
    cache = { at: Date.now(), body: await build() };
    if (!bad(cache.body)) lastGood = cache;
  }
  const body = bad(cache.body) && lastGood && Date.now() - lastGood.at < 15 * 60_000 ? lastGood.body : cache.body;
  return NextResponse.json(body, { headers: { "cache-control": "public, max-age=30" } });
}
