// MetaVault SELECT (SPEC §6.5.2): score this week's basket members and pick at most `maxConcurrent` above the bar.
//   npm run select -w keeper                      -> SELECT_OUT (default keeper/logs/select-<date>.json)
//   score = w1 × (7d pool-volume growth %) + w2 × (top non-USDG pool's share of volume %)
// Zero picks is the expected, normal outcome most weeks. Deterministic, no model involved.
//
// Growth for a young pool (the whole point of the basket: GLXY squeezed 4 days after listing) is measured over the
// history that exists: the last half of [max(firstSwap window start, now-14d), now] against the first half. A pool
// with less than 2 days of history has growth 0 (share still counts).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, parseAbi, type Hex } from "viem";
import { makeClient, logClient, blockAtOrBefore, swapLogs, POOL_MANAGER, type Client } from "./chain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as Hex;
const DAY = 86_400;

export interface SelectConfig {
  w1: number;
  w2: number;
  minScoreBps: number; // score × 100 must reach this
  maxConcurrent: number; // MetaVault param (default 2, <= 3)
}
/** Starting defaults (tunable; every week's scores are logged so the bar can be revisited with data). */
export const SELECT_DEFAULTS: SelectConfig = { w1: 1, w2: 1, minScoreBps: 10_000, maxConcurrent: 2 };

export interface PoolVolume {
  poolId: string;
  quote: string; // lowercased quote token (USDG or anything else)
  createdAt: number;
  swaps: { ts: number; stock: number }[]; // |stock leg| per swap, whole tokens
}
export interface VolumeStats {
  ticker: string;
  token: string;
  windowDays: number;
  volRecent: number;
  volPrior: number;
  growthPct: number;
  topNonUsdgQuote: string | null;
  topNonUsdgSharePct: number;
}

/** Pure: per-ticker volume growth and top non-USDG share from swap history (unit-tested). */
export function volumeStats(ticker: string, token: string, pools: PoolVolume[], now: number): VolumeStats {
  const all = pools.flatMap((p) => p.swaps);
  const start = Math.max(now - 14 * DAY, Math.min(now, ...pools.map((p) => p.createdAt)));
  const span = now - start;
  const mid = start + span / 2;
  let volRecent = 0;
  let volPrior = 0;
  for (const s of all) {
    if (s.ts < start || s.ts > now) continue;
    if (s.ts >= mid) volRecent += s.stock;
    else volPrior += s.stock;
  }
  const growthPct = span < 2 * DAY || volPrior === 0 ? 0 : ((volRecent - volPrior) / volPrior) * 100;
  const total = volRecent + volPrior;
  const perPool = pools
    .filter((p) => p.quote !== USDG)
    .map((p) => ({ quote: p.quote, vol: p.swaps.filter((s) => s.ts >= start && s.ts <= now).reduce((a, s) => a + s.stock, 0) }))
    .sort((a, b) => b.vol - a.vol);
  const top = perPool[0] && perPool[0].vol > 0 ? perPool[0] : null;
  return {
    ticker,
    token,
    windowDays: Math.round((span / DAY) * 10) / 10,
    volRecent: round(volRecent),
    volPrior: round(volPrior),
    growthPct: round(growthPct),
    topNonUsdgQuote: top?.quote ?? null,
    topNonUsdgSharePct: top && total > 0 ? round((top.vol / total) * 100) : 0,
  };
}

export interface Scored extends VolumeStats {
  score: number;
  eligible: boolean;
  reason: string;
}

/** Pure: score, filter, and pick (unit-tested). */
export function select(
  stats: VolumeStats[],
  cfg: SelectConfig,
  exclude: { skip?: string[]; blacklisted?: string[] } = {},
): { picks: Scored[]; scored: Scored[] } {
  const skip = new Set((exclude.skip ?? []).map((s) => s.toUpperCase()));
  const bl = new Set((exclude.blacklisted ?? []).map((s) => s.toLowerCase()));
  const scored = stats
    .map((s) => {
      const score = round(cfg.w1 * s.growthPct + cfg.w2 * s.topNonUsdgSharePct);
      let reason = "ok";
      if (skip.has(s.ticker.toUpperCase())) reason = "skip / earnings list";
      else if (bl.has(s.token.toLowerCase())) reason = "blacklisted (weeklyLossCapBps)";
      else if (score * 100 < cfg.minScoreBps) reason = `score ${score} below bar ${cfg.minScoreBps / 100}`;
      return { ...s, score, eligible: reason === "ok", reason };
    })
    .sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
  return { picks: scored.filter((s) => s.eligible).slice(0, cfg.maxConcurrent), scored };
}

const round = (x: number) => Math.round(x * 100) / 100;

// ------------------------------------------------------------------ chain reads (read-only mainnet)

const topicOf = (a: string) => `0x${a.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);

/** Every v4 pool (any quote) of the given tokens, with live liquidity, and 14 days of their swaps. */
async function fetchPools(c: Client, tokens: string[], sinceTs: number): Promise<Map<string, PoolVolume[]>> {
  const head = await c.getBlockNumber();
  const from = await blockAtOrBefore(c, sinceTs);
  const topics = tokens.map(topicOf);
  const init: any[] = [];
  for (const pos of [2, 3]) {
    const t: (Hex | Hex[] | null)[] = [INIT_TOPIC, null, null, null];
    t[pos] = topics as Hex[];
    init.push(...(await getLogsSplit(c, t, from, head)));
  }
  const pools: { token: string; poolId: Hex; quote: string; stockIs0: boolean; block: bigint }[] = [];
  const set = new Set(tokens.map((t) => t.toLowerCase()));
  for (const l of init) {
    const c0 = ("0x" + l.topics[2].slice(26)).toLowerCase();
    const c1 = ("0x" + l.topics[3].slice(26)).toLowerCase();
    const stockIs0 = set.has(c0);
    pools.push({ token: stockIs0 ? c0 : c1, poolId: l.topics[1], quote: stockIs0 ? c1 : c0, stockIs0, block: BigInt(l.blockNumber) });
  }
  // live liquidity only (a pool with L = 0 cannot trade)
  const slotOf = (id: Hex) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n]))) + 3n;
  const live: typeof pools = [];
  for (let i = 0; i < pools.length; i += 500) {
    const chunk = pools.slice(i, i + 500);
    const res = await c.multicall({
      contracts: chunk.map((p) => ({
        address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const,
        args: [`0x${slotOf(p.poolId).toString(16).padStart(64, "0")}` as Hex] as const,
      })),
      allowFailure: true,
    });
    chunk.forEach((p, j) => {
      if (res[j].status === "success" && (BigInt(res[j].result as Hex) & ((1n << 128n) - 1n)) > 0n) live.push(p);
    });
  }
  const byId = new Map(live.map((p) => [p.poolId.toLowerCase(), { p, swaps: [] as { ts: number; stock: number }[] }]));
  const ids = [...byId.keys()] as Hex[];
  for (let i = 0; i < ids.length; i += 150) {
    for (const l of await swapLogs(c, ids.slice(i, i + 150), from, head)) {
      const e = byId.get(l.poolId.toLowerCase())!;
      e.swaps.push({ ts: l.ts, stock: Math.abs(Number(e.p.stockIs0 ? l.amount0 : l.amount1)) / 1e18 });
    }
  }
  const createdAt = new Map<bigint, number>();
  const out = new Map<string, PoolVolume[]>();
  for (const { p, swaps } of byId.values()) {
    if (!createdAt.has(p.block)) createdAt.set(p.block, Number((await c.getBlock({ blockNumber: p.block })).timestamp));
    (out.get(p.token) ?? out.set(p.token, []).get(p.token)!).push({ poolId: p.poolId, quote: p.quote, createdAt: createdAt.get(p.block)!, swaps });
  }
  return out;
}

async function getLogsSplit(c: Client, topics: (Hex | Hex[] | null)[], from: bigint, to: bigint): Promise<any[]> {
  try {
    return await logClient().request({
      method: "eth_getLogs",
      params: [{ address: POOL_MANAGER, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }],
    } as any);
  } catch (e) {
    if (to - from < 1000n) throw e;
    const mid = (from + to) / 2n;
    return [...(await getLogsSplit(c, topics, from, mid)), ...(await getLogsSplit(c, topics, mid + 1n, to))];
  }
}

/** One SELECT pass over the current basket; writes the full scored table (picks + why everything else was not). */
export async function runSelect(cfg: SelectConfig = SELECT_DEFAULTS, opts: { skip?: string[]; blacklisted?: string[] } = {}) {
  const basketPath = process.env.BASKET_PATH ?? join(ROOT, "contracts/config/basket.json");
  const basket = JSON.parse(readFileSync(basketPath, "utf8"));
  const members: { ticker: string; token: string }[] = basket.members;
  const c = makeClient();
  const now = Number((await c.getBlock()).timestamp);
  const pools = await fetchPools(c, members.map((m) => m.token.toLowerCase()), now - 14 * DAY);
  const stats = members.map((m) => volumeStats(m.ticker, m.token, pools.get(m.token.toLowerCase()) ?? [], now));
  const res = select(stats, cfg, opts);
  const doc = { generatedAt: new Date(now * 1000).toISOString(), basketGeneratedAt: basket.generatedAt, config: cfg, picks: res.picks.map((p) => p.ticker), scored: res.scored };
  const out = process.env.SELECT_OUT ?? join(ROOT, `keeper/logs/select-${doc.generatedAt.slice(0, 10)}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2));
  console.log(`SELECT: ${res.picks.length} pick(s) [${doc.picks.join(", ")}] of ${members.length} members -> ${out}`);
  for (const s of res.scored.slice(0, 10)) console.log(`  ${s.ticker.padEnd(6)} score ${String(s.score).padStart(8)}  growth ${s.growthPct}%  nonUSDG ${s.topNonUsdgSharePct}%  ${s.reason}`);
  return doc;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  runSelect().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
