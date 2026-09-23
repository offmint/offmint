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

export function makeClient() {
  const urls = [process.env.ALCHEMY_RH_MAINNET_URL, process.env.RH_MAINNET_RPC, "https://rpc.mainnet.chain.robinhood.com"]
    .filter((u): u is string => !!u);
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

/** Greatest block with timestamp <= ts (binary search). */
export async function blockAtOrBefore(c: Client, ts: number): Promise<bigint> {
  let hi = await c.getBlockNumber();
  const top = await c.getBlock({ blockNumber: hi });
  if (Number(top.timestamp) <= ts) return hi;
  // ~10 blocks/s on Robinhood Chain; start with a guess to shorten the search
  let lo = hi - BigInt(Math.ceil((Number(top.timestamp) - ts) * 12)) - 10_000n;
  if (lo < 0n) lo = 0n;
  while (Number((await c.getBlock({ blockNumber: lo })).timestamp) > ts) lo = lo / 2n;
  while (lo < hi) {
    const mid = (lo + hi + 1n) / 2n;
    if (Number((await c.getBlock({ blockNumber: mid })).timestamp) <= ts) lo = mid;
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

/** Swap logs for the given pools in [from, to], chunked adaptively. */
export async function swapLogs(c: Client, poolIds: Hex[], from: bigint, to: bigint): Promise<SwapLog[]> {
  const out: SwapLog[] = [];
  const latest = await c.getBlockNumber();
  let chunk = 400_000n;
  for (let start = from; start <= to; ) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    let raw: any[];
    try {
      raw = await c.request({
        method: "eth_getLogs",
        params: [{ address: POOL_MANAGER, fromBlock: `0x${start.toString(16)}`, toBlock: `0x${end.toString(16)}`, topics: [SWAP_TOPIC, poolIds] }],
      } as any);
    } catch (e) {
      if (chunk <= 1_000n) throw e;
      chunk /= 4n;
      continue;
    }
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
export async function lastSwapBefore(c: Client, poolId: Hex, block: bigint, maxLookback = 20_000_000n): Promise<SwapLog | undefined> {
  for (let span = 200_000n; span <= maxLookback; span *= 4n) {
    const from = block > span ? block - span : 0n;
    const logs = await swapLogs(c, [poolId], from, block);
    if (logs.length) return logs.at(-1);
    if (from === 0n) break;
  }
  return undefined;
}
