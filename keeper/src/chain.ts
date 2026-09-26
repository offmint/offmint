// Read-only chain access for the keeper / paper mode. Works on the public RPC (no archive state needed):
// historical pool prices come from Swap logs (each carries the post-swap sqrtPriceX96), feed history from getRoundData.
import { createPublicClient, http, fallback, keccak256, encodeAbiParameters, parseAbi, decodeEventLog, type Hex, type Address } from "viem";

export const POOL_MANAGER: Address = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const POOLS_SLOT = 6n;

export const robinhood = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  // canonical Multicall3 (verified deployed on Robinhood mainnet 2026-09-23)
  contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const } },
} as const;

/**
 * Log scans (eth_getLogs) always go to a log-capable RPC: Alchemy's free tier limits eth_getLogs to a 10-block range,
 * so an Alchemy URL is used for reads and calls only. RH_MAINNET_RPC (or the public endpoint) serves logs.
 */
let _logClient: Client | undefined;
export function logClient(): Client {
  _logClient ??= createPublicClient({
    chain: robinhood,
    transport: http(process.env.RH_MAINNET_RPC || "https://rpc.mainnet.chain.robinhood.com", { retryCount: 6, retryDelay: 1_000, timeout: 60_000 }),
  }) as unknown as Client;
  return _logClient;
}

/** Which RPC a URL is, for logs: never prints the URL (an Alchemy URL contains the API key). */
export const rpcKind = (u: string) => (/alchemy/i.test(u) ? "alchemy" : /rpc\.(mainnet|testnet)\.chain\.robinhood\.com/.test(u) ? "public" : "custom");
let rpcLogged = false;

export function makeClient() {
  const urls = [process.env.ALCHEMY_RH_MAINNET_URL, process.env.RH_MAINNET_RPC, "https://rpc.mainnet.chain.robinhood.com"]
    .filter((u): u is string => !!u);
  if (!rpcLogged) {
    rpcLogged = true;
    console.error(JSON.stringify({
      event: "rpc", network: "mainnet", using: rpcKind(urls[0]) === "alchemy" ? "alchemy" : "public fallback",
      expects: ["ALCHEMY_RH_MAINNET_URL", "RH_MAINNET_RPC"],
      set: { ALCHEMY_RH_MAINNET_URL: !!process.env.ALCHEMY_RH_MAINNET_URL, RH_MAINNET_RPC: !!process.env.RH_MAINNET_RPC },
    }));
  }
  return createPublicClient({
    chain: robinhood,
    transport: fallback([...new Set(urls)].map((u) => http(u, { retryCount: 6, retryDelay: 1_000, timeout: 60_000 }))),
  });
}
export type Client = ReturnType<typeof makeClient>;

export const feedAbi = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
export const stockAbi = parseAbi(["function oraclePaused() view returns (bool)", "function uiMultiplier() view returns (uint256)"]);
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
export const swapEvent = parseAbi([
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
]);
export const SWAP_TOPIC = keccak256(new TextEncoder().encode("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)"));

export interface Round { roundId: bigint; answer: bigint; updatedAt: number }

export async function latestRound(c: Client, feed: Address): Promise<Round> {
  const [roundId, answer, , updatedAt] = await c.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
  return { roundId, answer, updatedAt: Number(updatedAt) };
}

/** Walks feed rounds backwards from the latest until updatedAt < `since`, 50 rounds per Multicall3 batch.
 *  Returned oldest -> newest. */
export async function feedHistory(c: Client, feed: Address, since: number): Promise<Round[]> {
  const latest = await latestRound(c, feed);
  const out: Round[] = [latest];
  const phaseStart = (latest.roundId >> 64n) << 64n;
  let next = latest.roundId - 1n;
  while (next > phaseStart && out[out.length - 1].updatedAt >= since) {
    const ids: bigint[] = [];
    for (let i = 0n; i < 50n && next - i > phaseStart; i++) ids.push(next - i);
    const res = await c.multicall({
      contracts: ids.map((id) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [id] as const })),
      allowFailure: true,
    });
    let stop = ids.length === 0;
    for (const r of res) {
      if (r.status !== "success") continue;
      const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      if (updatedAt === 0n) {
        stop = true;
        break;
      }
      out.push({ roundId, answer, updatedAt: Number(updatedAt) });
      if (Number(updatedAt) < since) {
        stop = true;
        break;
      }
    }
    if (stop) break;
    next -= BigInt(ids.length);
  }
  return out.reverse();
}

/** Last round with updatedAt <= t (undefined if none). */
export const roundAt = (h: Round[], t: number) => h.filter((r) => r.updatedAt <= t).at(-1);

export async function slot0(
  c: Pick<Client, "getBlockNumber" | "readContract">,
  poolId: Hex,
  pm: Address = POOL_MANAGER,
): Promise<{ sqrtPriceX96: bigint; tick: number; block: bigint }> {
  const slot = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [poolId, POOLS_SLOT]));
  // read at "latest" directly: viem caches getBlockNumber() for a few seconds, which made reads stale right after a trade
  const [word0, block] = await Promise.all([
    c.readContract({ address: pm, abi: pmAbi, functionName: "extsload", args: [slot], blockTag: "latest" }),
    c.getBlockNumber({ cacheTime: 0 }),
  ]);
  const word = BigInt(word0);
  const sqrtPriceX96 = word & ((1n << 160n) - 1n);
  let tick = Number((word >> 160n) & 0xffffffn);
  if (tick >= 1 << 23) tick -= 1 << 24;
  return { sqrtPriceX96, tick, block };
}

/** v4 PoolId = keccak256(abi.encode(PoolKey)). */
export function poolIdOf(k: { currency0: Address; currency1: Address; fee: number; tickSpacing: number; hooks: Address }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
      [k.currency0, k.currency1, k.fee, k.tickSpacing, k.hooks],
    ),
  );
}

/**
 * Greatest block with timestamp <= ts. Block production on Robinhood Chain is steady (~10/s), so a secant estimate
 * lands within a few blocks after 2-4 getBlock calls; a short binary search finishes the job. (A plain binary search
 * cost ~27 calls, which dominated historical scans on the rate-limited public RPC.)
 */
export async function blockAtOrBefore(c: Client, ts: number): Promise<bigint> {
  const top = await c.getBlock();
  if (Number(top.timestamp) <= ts) return top.number;
  const clamp = (b: bigint) => (b < 0n ? 0n : b > top.number ? top.number : b);
  const tsOf = async (b: bigint) => Number((await c.getBlock({ blockNumber: clamp(b) })).timestamp);
  const RATE = 10; // blocks per second on Robinhood Chain (steady); only used to aim, correctness comes from the search
  let g = clamp(top.number - BigInt(Math.ceil((Number(top.timestamp) - ts) * RATE)));
  for (let i = 0; i < 3; i++) {
    const t = await tsOf(g);
    if (Math.abs(t - ts) <= 2) break;
    // the rate was far lower before July 2026, so an aim can overshoot the head or genesis: keep it on the chain
    g = clamp(g + BigInt(Math.round((ts - t) * RATE)));
  }
  // bracket [lo, hi] with ts(lo) <= ts < ts(hi), widening if the aim was off
  let w = 100n;
  let lo = g - w;
  while (lo > 0n && (await tsOf(lo)) > ts) lo -= (w *= 4n);
  if (lo < 0n) lo = 0n;
  w = 100n;
  let hi = g + w;
  while (hi < top.number && (await tsOf(hi)) <= ts) hi += (w *= 4n);
  if (hi > top.number) hi = top.number;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if ((await tsOf(mid)) <= ts) lo = mid;
    else hi = mid - 1n;
  }
  return lo;
}

export interface SwapLog {
  poolId: Hex;
  block: bigint;
  logIndex: number;
  ts: number;
  sqrtPriceX96: bigint;
  tick: number;
  fee: number;
  amount0: bigint; // swapper's delta: negative = paid into the pool
  amount1: bigint;
  liquidity: bigint; // pool active liquidity after the swap
}

// Older logs on this node carry blockTimestamp = 0x0, so fall back to interpolating between anchor blocks
// (cached, every 65536 blocks ~ 1.8 h at ~10 blocks/s; block production is steady, so error is ~minutes).
// A coarser grid keeps historical scans inside the public RPC's rate limit.
const ANCHOR = 65536n;
const anchorTs = new Map<bigint, number>();
async function anchor(c: Client, b: bigint): Promise<number> {
  let t = anchorTs.get(b);
  if (t === undefined) {
    t = Number((await c.getBlock({ blockNumber: b })).timestamp);
    anchorTs.set(b, t);
  }
  return t;
}
export async function blockTime(c: Client, b: bigint, latest?: bigint): Promise<number> {
  const lo = (b / ANCHOR) * ANCHOR;
  if (lo === b) return anchor(c, b);
  latest ??= await c.getBlockNumber();
  const hi = lo + ANCHOR > latest ? latest : lo + ANCHOR;
  if (hi <= b) return Number((await c.getBlock({ blockNumber: b })).timestamp);
  const [tl, th] = [await anchor(c, lo), await anchor(c, hi)];
  return Math.round(tl + ((th - tl) * Number(b - lo)) / Number(hi - lo));
}

/** Public-RPC rate limit (HTTP 429): wait and retry the same request instead of shrinking the block range. */
export const isRateLimited = (e: any) => e?.status === 429 || e?.code === 429 || e?.cause?.code === 429 || /too many requests/i.test(String(e?.details ?? e?.message ?? ""));
export async function backoff(attempt: number): Promise<void> {
  if (attempt >= 12) throw new Error("RPC still rate-limited after 12 retries");
  await new Promise((r) => setTimeout(r, Math.min(60_000, 2_000 * 2 ** attempt)));
}

/** Swap logs for the given pools in [from, to], chunked adaptively. */
export async function swapLogs(c: Client, poolIds: Hex[], from: bigint, to: bigint): Promise<SwapLog[]> {
  const out: SwapLog[] = [];
  const latest = await c.getBlockNumber();
  let chunk = 400_000n;
  let limited = 0;
  for (let start = from; start <= to; ) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    let raw: any[];
    try {
      raw = await logClient().request({
        method: "eth_getLogs",
        params: [{ address: POOL_MANAGER, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [SWAP_TOPIC, poolIds] }],
      } as any);
    } catch (e) {
      if (isRateLimited(e)) {
        await backoff(limited++);
        continue;
      }
      if (chunk <= 1_000n) throw e;
      chunk /= 4n;
      continue;
    }
    limited = 0;
    // one error (busy block range) should not keep every later request tiny: grow back toward the cap
    if (chunk < 400_000n) chunk *= 2n;
    for (const l of raw) {
      const ev = decodeEventLog({ abi: swapEvent, data: l.data, topics: l.topics });
      out.push({
        poolId: l.topics[1],
        block: BigInt(l.blockNumber),
        logIndex: Number(l.logIndex),
        ts: l.blockTimestamp && BigInt(l.blockTimestamp) > 0n ? Number(BigInt(l.blockTimestamp)) : await blockTime(c, BigInt(l.blockNumber), latest),
        sqrtPriceX96: ev.args.sqrtPriceX96,
        tick: ev.args.tick,
        fee: ev.args.fee,
        amount0: ev.args.amount0,
        amount1: ev.args.amount1,
        liquidity: ev.args.liquidity,
      });
    }
    start = end + 1n;
  }
  return out;
}

/** Most recent swap at or before `block` (scans backwards in widening windows). */
export async function lastSwapBefore(c: Client, poolId: Hex, block: bigint, maxLookback = 3_200_000n): Promise<SwapLog | undefined> {
  for (let span = 200_000n; span <= maxLookback; span *= 4n) {
    const from = block > span ? block - span : 0n;
    const logs = await swapLogs(c, [poolId], from, block);
    if (logs.length) return logs.at(-1);
    if (from === 0n) break;
  }
  return undefined;
}
