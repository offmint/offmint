// Detector (SPEC §3.7): the live process that replaced a fixed ticker list.
//   npm run detect -w keeper                 one pass -> basket.json
//   npm run detect -w keeper -- --watch 360  re-run every 360 minutes
// 1. Discover  STOCK/USDG v4 pools (PoolManager Initialize logs), incrementally from a cached last-scanned block.
// 2. Verify    the stock address is in Robinhood's canonical /rhj/assets registry AND its onchain symbol()/decimals()
//              match. Copycat tokens that mimic ticker symbols are a documented scam pattern on this chain: anything
//              failing this is recorded as rejected and never enters the basket.
// 3. Classify  no live Chainlink feed AND pool age <= vulnerableWindowDays -> basket member (PushPriceReference path).
//              A live feed -> not a member ("graduated"; majors don't squeeze).
// 4. Floor     USDG needed to push the pool +10% must be >= minDepthUsd, or there is nothing real to arm a ladder into.
// 5. Output    basket.json (BASKET_PATH, default contracts/config/basket.json) with members AND exclusions + reasons.
// Deterministic automation, no model involved.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from "viem";
import { makeClient, blockTime, POOL_MANAGER, type Client } from "../src/chain.js";
import { sqrtPriceX96ToUsd } from "../src/rangeMath.js";
import { stockDepthWithin10, usdToPush10 } from "../src/depth.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as Hex;
const ZERO = "0x0000000000000000000000000000000000000000";
const D8 = { feed: 8, stock: 18, usd: 6 };

export interface DetectorConfig {
  vulnerableWindowDays: number;
  minDepthUsd: number;
}
export const DEFAULTS: DetectorConfig = { vulnerableWindowDays: 30, minDepthUsd: 2_000 };

export interface Candidate {
  ticker: string;
  token: string;
  inRegistry: boolean;
  onchainSymbol: string | null;
  onchainDecimals: number | null;
  hasFeed: boolean;
  poolAgeDays: number | null;
  depthUsdTo10: number | null;
}

export type Verdict = { member: true; path: "push-price" } | { member: false; reason: string };

/** Pure §3.7 decision for one token (unit-tested). Order matters: verification always comes first. */
export function judge(c: Candidate, cfg: DetectorConfig): Verdict {
  if (!c.inRegistry) return { member: false, reason: "not in canonical /rhj/assets registry (possible copycat)" };
  if (c.onchainSymbol !== c.ticker) return { member: false, reason: `onchain symbol ${c.onchainSymbol ?? "?"} != registry ${c.ticker}` };
  if (c.onchainDecimals !== 18) return { member: false, reason: `decimals ${c.onchainDecimals ?? "?"} != 18` };
  if (c.hasFeed) return { member: false, reason: "graduated: live Chainlink feed (majors don't squeeze)" };
  if (c.poolAgeDays === null) return { member: false, reason: "no hook-free STOCK/USDG pool" };
  if (c.poolAgeDays > cfg.vulnerableWindowDays) return { member: false, reason: `pool ${c.poolAgeDays}d old > ${cfg.vulnerableWindowDays}d window` };
  if ((c.depthUsdTo10 ?? 0) < cfg.minDepthUsd) return { member: false, reason: `depth $${Math.round(c.depthUsdTo10 ?? 0)} to +10% < $${cfg.minDepthUsd} floor` };
  return { member: true, path: "push-price" };
}

const topicOf = (a: string) => `0x${a.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
const erc20 = parseAbi(["function symbol() view returns (string)", "function decimals() view returns (uint8)"]);
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);

interface PoolRec {
  poolId: Hex;
  stockIs0: boolean;
  fee: number;
  tickSpacing: number;
  hooks: string;
  createdBlock: string;
  createdAt: number;
}
interface Cache {
  lastBlock: string;
  pools: Record<string, PoolRec[]>; // by lowercased non-USDG token address
}

async function getLogsSplit(c: Client, topics: (Hex | null)[], from: bigint, to: bigint): Promise<any[]> {
  try {
    return await c.request({
      method: "eth_getLogs",
      params: [{ address: POOL_MANAGER, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics }],
    } as any);
  } catch (e) {
    if (!/exceeds limit|10000|too many/i.test(String(e)) || to - from < 1000n) throw e;
    const mid = (from + to) / 2n;
    return [...(await getLogsSplit(c, topics, from, mid)), ...(await getLogsSplit(c, topics, mid + 1n, to))];
  }
}

/** Incrementally discovers every USDG pool (either side) since the cached block. */
async function discover(c: Client, cachePath: string, registry: Set<string>): Promise<Cache> {
  const cache: Cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { lastBlock: "0", pools: {} };
  const head = await c.getBlockNumber();
  const from = BigInt(cache.lastBlock) + 1n;
  if (from > head) return cache;
  const logs = [
    ...(await getLogsSplit(c, [INIT_TOPIC, null, topicOf(USDG)], from, head)),
    ...(await getLogsSplit(c, [INIT_TOPIC, null, null, topicOf(USDG)], from, head)),
  ];
  const latest = await c.getBlockNumber();
  for (const l of logs) {
    const d = l.data.slice(2);
    const word = (i: number) => BigInt("0x" + d.slice(i * 64, i * 64 + 64));
    const c0 = ("0x" + l.topics[2].slice(26)).toLowerCase();
    const c1 = ("0x" + l.topics[3].slice(26)).toLowerCase();
    const stockIs0 = c1 === USDG;
    const other = stockIs0 ? c0 : c1;
    let ts = Number(word(1) & 0xffffffn);
    if (ts >= 1 << 23) ts -= 1 << 24;
    // pairs with non-registry tokens are only counted (never basket members): skip their timestamp lookups
    const at = !registry.has(other)
      ? 0
      : l.blockTimestamp && BigInt(l.blockTimestamp) > 0n
        ? Number(BigInt(l.blockTimestamp))
        : await blockTime(c, BigInt(l.blockNumber), latest); // interpolated from cached anchors
    (cache.pools[other] ??= []).push({
      poolId: l.topics[1], stockIs0, fee: Number(word(0)), tickSpacing: ts, hooks: "0x" + d.slice(2 * 64 + 24, 3 * 64),
      createdBlock: BigInt(l.blockNumber).toString(), createdAt: at,
    });
  }
  cache.lastBlock = head.toString();
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(cache));
  return cache;
}

export async function runDetector(cfg: DetectorConfig = DEFAULTS, out = process.env.BASKET_PATH ?? join(ROOT, "contracts/config/basket.json")) {
  const c = makeClient();
  const now = Number((await c.getBlock()).timestamp);
  const cachePath = process.env.DETECTOR_CACHE ?? join(dirname(out), ".detector-cache.json");
  const [registry, feeds] = await Promise.all([
    fetch("https://api.robinhood.com/rhj/assets").then((r) => r.json()),
    fetch("https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json").then((r) => r.json()),
  ]);
  const reg = new Map<string, any>();
  for (const a of registry.assets as any[]) {
    const d = a.deployments.find((x: any) => x.chainId === 4663);
    if (d) reg.set(d.contractAddress.toLowerCase(), a);
  }
  const cache = await discover(c, cachePath, new Set(reg.keys()));
  const feedBy = new Map<string, any>();
  for (const f of feeds as any[]) if (f.name.startsWith("Robinhood ")) feedBy.set(f.name.split(" ")[1].split(/[-/]/)[0].trim(), f);

  // hook-free pools only (CLAUDE.md gotcha 8); read state of every candidate pool in Multicall3 batches
  const tokens = Object.keys(cache.pools);
  const hookFree = tokens
    .filter((t) => reg.has(t))
    .flatMap((t) => cache.pools[t].filter((p) => p.hooks.toLowerCase() === ZERO).map((p) => ({ t, p })));
  const slotOf = (id: Hex) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])));
  const state = new Map<string, { sqrt: bigint; L: bigint }>();
  for (let i = 0; i < hookFree.length; i += 500) {
    const chunk = hookFree.slice(i, i + 500);
    const res = await c.multicall({
      contracts: chunk.flatMap(({ p }) => [
        { address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const, args: [`0x${slotOf(p.poolId).toString(16).padStart(64, "0")}` as Hex] as const },
        { address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const, args: [`0x${(slotOf(p.poolId) + 3n).toString(16).padStart(64, "0")}` as Hex] as const },
      ]),
      allowFailure: true,
    });
    chunk.forEach(({ p }, j) => {
      const w0 = res[2 * j].status === "success" ? BigInt(res[2 * j].result as Hex) : 0n;
      const w3 = res[2 * j + 1].status === "success" ? BigInt(res[2 * j + 1].result as Hex) : 0n;
      state.set(p.poolId, { sqrt: w0 & ((1n << 160n) - 1n), L: w3 & ((1n << 128n) - 1n) });
    });
  }
  // onchain symbol/decimals for every registry token that has a pool (verification step)
  const regTokens = tokens.filter((t) => reg.has(t));
  const meta = new Map<string, { symbol: string | null; decimals: number | null }>();
  for (let i = 0; i < regTokens.length; i += 200) {
    const chunk = regTokens.slice(i, i + 200);
    const res = await c.multicall({
      contracts: chunk.flatMap((t) => [
        { address: t as Address, abi: erc20, functionName: "symbol" as const },
        { address: t as Address, abi: erc20, functionName: "decimals" as const },
      ]),
      allowFailure: true,
    });
    chunk.forEach((t, j) =>
      meta.set(t, {
        symbol: res[2 * j].status === "success" ? String(res[2 * j].result) : null,
        decimals: res[2 * j + 1].status === "success" ? Number(res[2 * j + 1].result) : null,
      }),
    );
  }

  const members: any[] = [];
  const excluded: any[] = [];
  let copycats = 0;
  for (const t of tokens) {
    const a = reg.get(t);
    const ticker = a?.tokenSymbol ?? "?";
    const pools = cache.pools[t].filter((p) => p.hooks.toLowerCase() === ZERO && (state.get(p.poolId)?.L ?? 0n) > 0n);
    // deepest hook-free USDG pool by stock-side depth within +10%
    const best = pools
      .map((p) => ({ p, s: state.get(p.poolId)! }))
      .sort((x, y) => stockDepthWithin10(y.s.L, y.s.sqrt, y.p.stockIs0) - stockDepthWithin10(x.s.L, x.s.sqrt, x.p.stockIs0))[0];
    const priceUsd = best ? Number(sqrtPriceX96ToUsd(best.s.sqrt, D8, best.p.stockIs0)) / 1e8 : null;
    const cand: Candidate = {
      ticker,
      token: t,
      inRegistry: !!a,
      onchainSymbol: meta.get(t)?.symbol ?? null,
      onchainDecimals: meta.get(t)?.decimals ?? null,
      hasFeed: !!feedBy.get(ticker),
      poolAgeDays: best ? Math.round(((now - best.p.createdAt) / 86_400) * 10) / 10 : null,
      depthUsdTo10: best && priceUsd ? Math.round(usdToPush10(best.s.L, priceUsd, best.p.stockIs0)) : null,
    };
    const v = judge(cand, cfg);
    if (!a) {
      copycats++;
      continue; // not a Robinhood stock token at all: counted, never listed
    }
    const rec = {
      ...cand,
      name: a.tokenName,
      currentMultiplier: a.currentMultiplier,
      priceUsd,
      pool: best
        ? {
            poolId: best.p.poolId,
            stockIsCurrency0: best.p.stockIs0,
            poolKey: {
              currency0: best.p.stockIs0 ? a.deployments.find((d: any) => d.chainId === 4663).contractAddress : USDG,
              currency1: best.p.stockIs0 ? USDG : a.deployments.find((d: any) => d.chainId === 4663).contractAddress,
              fee: best.p.fee,
              tickSpacing: best.p.tickSpacing,
              hooks: ZERO,
            },
            createdAt: new Date(best.p.createdAt * 1000).toISOString(),
          }
        : null,
    };
    if (v.member) members.push({ ...rec, path: v.path });
    else excluded.push({ ...rec, reason: v.reason });
  }
  members.sort((x, y) => (x.poolAgeDays ?? 0) - (y.poolAgeDays ?? 0));
  const doc = {
    generatedAt: new Date().toISOString(),
    rule: `member = in canonical registry AND onchain symbol/decimals match AND no Chainlink feed AND deepest hook-free USDG pool <= ${cfg.vulnerableWindowDays}d old AND >= $${cfg.minDepthUsd} to push +10%`,
    config: cfg,
    counts: { members: members.length, excluded: excluded.length, nonRegistryUsdgPairsIgnored: copycats },
    members,
    excluded,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 1) + "\n");
  return doc;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const watch = args.includes("--watch") ? Number(args[args.indexOf("--watch") + 1] ?? 360) : 0;
  for (;;) {
    const doc = await runDetector();
    console.log(JSON.stringify({ event: "basket", at: doc.generatedAt, ...doc.counts, members: doc.members.map((m: any) => m.ticker) }));
    if (!watch) break;
    await new Promise((r) => setTimeout(r, watch * 60_000));
  }
}
