// Live basket data for the landing page and /monitor, computed server-side and cached for 60 s:
// basket membership from the detector (paper service), pool prices and last swaps read onchain (mainnet), reference
// prices from Robinhood's Stock Token API (token-adjusted fields), an independent pool price from GeckoTerminal.
// Every premium goes through the quality gate (src/lib/liveGate.ts); only verified ones reach the landing page.
import { NextResponse } from "next/server";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, type Hex } from "viem";
import { gate, tokenRef, type GateResult } from "@/lib/liveGate";

const PAPER_API = process.env.NEXT_PUBLIC_PAPER_API || "https://offmint-keeper-production.up.railway.app";
// Read per call, not at module load: on Cloudflare the secrets reach process.env with the request.
const rpcUrl = () => process.env.ALCHEMY_RH_MAINNET_URL || process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
// Alchemy's free tier limits eth_getLogs to 10 blocks: log scans use the public RPC
const logsRpcUrl = () => process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const SWAP_TOPIC = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f" as Hex;
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);

export interface LiveRow extends GateResult {
  ticker: string; token: string; poolId: string; poolUsd: number | null; independentUsd: number | null;
  lastSwapAgeSec: number | null; depthUsdTo10: number; tvlUsd: number; poolAgeDays: number;
}
export interface Live {
  ok: boolean; updatedAt: string; rpc: "alchemy" | "public";
  basket: { live: boolean; generatedAt: string | null; count: number | null };
  rows: LiveRow[]; maxVerified: { ticker: string; pct: number } | null; verifiedCount: number; errors: string[];
}

let cache: { at: number; body: Live } | null = null;
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
  if (members.length) {
    const c = createPublicClient({ transport: http(rpcUrl(), { timeout: 15_000 }) });
    try {
      const slot = (id: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
      const res = await c.multicall({
        contracts: members.map((m) => ({ address: PM, abi: pmAbi, functionName: "extsload" as const, args: [slot(m.pool.poolId)] as const })),
        allowFailure: true,
        multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
      });
      members.forEach((m, i) => {
        if (res[i].status !== "success") return;
        const sqrt = Number(BigInt(res[i].result as Hex) & ((1n << 160n) - 1n)) / 2 ** 96;
        const p = sqrt * sqrt; // currency1 raw per currency0 raw
        if (p > 0) pool.set(m.token, m.pool.stockIsCurrency0 ? p * 1e12 : 1e12 / p); // 18-dec stock vs 6-dec USDG
      });
    } catch (e) {
      errors.push(`pools: ${String(e).slice(0, 80)}`);
    }
    try {
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
    } catch (e) {
      errors.push(`last swaps: ${String(e).slice(0, 80)}`);
    }
  }
  const ind = members.length ? await geckoPrices(members.map((m) => String(m.pool.poolId)), errors) : new Map();
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
    basket: { live: !!basket, generatedAt: basket?.generatedAt ?? null, count: basket ? members.length : null },
    rows,
    maxVerified: verified[0] ? { ticker: verified[0].ticker, pct: verified[0].premiumPct! } : null,
    verifiedCount: verified.length,
    errors,
  };
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), body: await build() };
  return NextResponse.json(cache.body, { headers: { "cache-control": "public, max-age=30" } });
}
