// Live basket data for the landing page and /monitor, computed server-side and cached for 60 s:
// basket membership from the detector (paper service), pool prices read onchain (mainnet), reference prices from
// Robinhood's Stock Token API. Any source that fails is reported as unavailable; nothing stale is passed off as live.
import { NextResponse } from "next/server";
import { createPublicClient, encodeAbiParameters, http, keccak256, parseAbi, type Hex } from "viem";

const PAPER_API = process.env.NEXT_PUBLIC_PAPER_API || "https://offmint-keeper-production.up.railway.app";
const RPC = process.env.ALCHEMY_RH_MAINNET_URL || process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com";
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951" as const;
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);

export interface LiveRow { ticker: string; token: string; poolUsd: number | null; refUsd: number | null; premiumPct: number | null; depthUsdTo10: number; tvlUsd: number; poolAgeDays: number }
export interface Live { ok: boolean; updatedAt: string; basket: { live: boolean; generatedAt: string | null; count: number | null }; rows: LiveRow[]; maxPremium: { ticker: string; pct: number } | null; errors: string[] }

let cache: { at: number; body: Live } | null = null;

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
  const prices = new Map<string, number>();
  try {
    const r = await fetch("https://api.robinhood.com/rhj/prices", { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const d = await r.json();
    for (const q of d.quotes ?? []) {
      const mid = (Number(q.tokenBid ?? q.bid) + Number(q.tokenAsk ?? q.ask)) / 2;
      if (mid > 0) prices.set(String(q.tokenSymbol), mid);
    }
  } catch (e) {
    errors.push(`prices: ${String(e).slice(0, 80)}`);
  }
  const pool = new Map<string, number>();
  if (members.length) {
    try {
      const c = createPublicClient({ transport: http(RPC, { timeout: 10_000 }) });
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
  }
  const rows: LiveRow[] = members.map((m) => {
    const poolUsd = pool.get(m.token) ?? null;
    const refUsd = prices.get(m.ticker) ?? null;
    return {
      ticker: m.ticker, token: m.token, poolUsd, refUsd,
      premiumPct: poolUsd && refUsd ? (poolUsd / refUsd - 1) * 100 : null,
      depthUsdTo10: m.depthUsdTo10, tvlUsd: m.tvlUsd, poolAgeDays: m.poolAgeDays,
    };
  });
  const withP = rows.filter((r) => r.premiumPct !== null).sort((a, b) => b.premiumPct! - a.premiumPct!);
  return {
    ok: errors.length === 0,
    updatedAt: new Date().toISOString(),
    basket: { live: !!basket, generatedAt: basket?.generatedAt ?? null, count: basket ? members.length : null },
    rows,
    maxPremium: withP[0] ? { ticker: withP[0].ticker, pct: withP[0].premiumPct! } : null,
    errors,
  };
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), body: await build() };
  return NextResponse.json(cache.body, { headers: { "cache-control": "public, max-age=30" } });
}
