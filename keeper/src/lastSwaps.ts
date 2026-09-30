// Last swap per basket pool, for the web /monitor quality gate (web/src/lib/liveGate.ts: a premium only counts if the
// pool traded recently). The web app runs on Cloudflare, whose shared egress IPs are rate-limited by the public RPC and
// Alchemy's free tier allows 10-block log queries, so the scan runs here, on the paper service's own IP, and the web
// reads GET /last-swaps.json. Incremental: the first run looks back LOOKBACK_SEC, later runs scan only new blocks.
// The same route carries GeckoTerminal's pool prices (the gate's independent check), fetched here for the same reason:
// GeckoTerminal rate-limits Cloudflare's shared IPs too.
import { encodeAbiParameters, keccak256, parseAbi, type Hex } from "viem";
import { blockAtOrBefore, POOL_MANAGER, swapLogs, type Client, type SwapLog } from "./chain.js";

export const LOOKBACK_SEC = 6 * 3600;

export interface LastSwaps {
  updatedAt: string | null;
  scannedTo: string | null; // last block scanned (decimal string)
  lookbackSec: number;
  /** poolId (lowercase) -> unix time of its last swap with liquidity in the look-back window */
  pools: Record<string, number>;
  /** basket pools already scanned from the look-back start (so a quiet pool isn't rescanned every run) */
  knownPools: string[];
  /** poolId (lowercase) -> sqrtPriceX96 (decimal string) at `scannedTo`: the web reads pool prices from here, because the
   *  public RPC sometimes refuses Cloudflare's shared IPs (29 Sep: 1 in 5 page loads had no pool prices) */
  sqrtPriceX96: Record<string, string>;
  error: string | null;
}

export const emptyLastSwaps = (): LastSwaps => ({ updatedAt: null, scannedTo: null, lookbackSec: LOOKBACK_SEC, pools: {}, knownPools: [], sqrtPriceX96: {}, error: null });

/** Fold new swap logs into the state: keep the latest time per pool, drop pools outside the look-back or the basket. */
export function mergeLastSwaps(prev: Record<string, number>, logs: Pick<SwapLog, "poolId" | "ts" | "liquidity">[], basket: string[], now: number): Record<string, number> {
  const keep = new Set(basket.map((p) => p.toLowerCase()));
  const out: Record<string, number> = {};
  for (const [id, ts] of Object.entries(prev)) if (keep.has(id) && ts >= now - LOOKBACK_SEC) out[id] = ts;
  for (const l of logs) {
    const id = l.poolId.toLowerCase();
    if (!keep.has(id) || l.liquidity === 0n) continue;
    if ((out[id] ?? 0) < l.ts) out[id] = l.ts;
  }
  return out;
}

/** One incremental scan. The basket can change between runs: a pool new to it is looked back for LOOKBACK_SEC. */
export async function refreshLastSwaps(c: Client, state: LastSwaps, basketPoolIds: Hex[]): Promise<LastSwaps> {
  const latest = await c.getBlock();
  const now = Number(latest.timestamp);
  const ids = basketPoolIds.map((p) => p.toLowerCase() as Hex);
  const known = new Set(state.scannedTo ? state.knownPools : []);
  const fresh = ids.filter((p) => !known.has(p));
  const logs: SwapLog[] = [];
  // new pools (or first run): the whole look-back window
  if (fresh.length) {
    const from = await blockAtOrBefore(c, now - LOOKBACK_SEC);
    logs.push(...(await swapLogs(c, fresh, from, latest.number)));
  }
  // known pools: only blocks since the last scan
  const old = ids.filter((p) => known.has(p));
  if (old.length && state.scannedTo && BigInt(state.scannedTo) < latest.number) {
    logs.push(...(await swapLogs(c, old, BigInt(state.scannedTo) + 1n, latest.number)));
  }
  return {
    updatedAt: new Date(now * 1000).toISOString(),
    scannedTo: latest.number.toString(),
    lookbackSec: LOOKBACK_SEC,
    pools: mergeLastSwaps(state.pools, logs, ids, now),
    knownPools: ids,
    sqrtPriceX96: await poolPrices(c, ids, latest.number),
    error: null,
  };
}

const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
/** sqrtPriceX96 of every pool at one block, in a single eth_call (PoolManager `extsload` of the pool's slot0). */
export async function poolPrices(c: Client, ids: Hex[], block: bigint): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const slot = (id: Hex) => keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]));
  const res = await c.multicall({
    contracts: ids.map((id) => ({ address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const, args: [slot(id)] as const })),
    allowFailure: true,
    batchSize: 0,
    blockNumber: block,
    multicallAddress: "0xcA11bde05977b3631167028862bE2a173976CA11",
  });
  const out: Record<string, string> = {};
  ids.forEach((id, i) => {
    const r = res[i];
    if (r.status !== "success") return;
    const sqrt = BigInt(r.result as Hex) & ((1n << 160n) - 1n);
    if (sqrt > 0n) out[id] = sqrt.toString();
  });
  return out;
}

/** GeckoTerminal price of the stock token in USDG, per pool (lowercase poolId). Same parsing as web/src/app/api/live. */
export async function independentPrices(poolIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < poolIds.length; i += 30) {
    const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/robinhood/pools/multi/${poolIds.slice(i, i + 30).join(",")}`, {
      signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`geckoterminal HTTP ${r.status}`);
    for (const p of ((await r.json()) as any).data ?? []) {
      const a = p.attributes;
      const stockIsBase = !/USDG/i.test(String(a.name ?? "").split("/")[0] ?? "");
      const px = Number(stockIsBase ? a.base_token_price_quote_token : a.quote_token_price_base_token);
      if (px > 0) out[String(a.address).toLowerCase()] = px;
    }
  }
  return out;
}
