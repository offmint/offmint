// M0.5 stage 1 (SPEC §3.5 steps 1-2): screen EVERY registry ticker for dislocation risk.
//   npm run screen -w backtest [-- --days 7]
// Per ticker: all Uniswap v4 pools (any quote currency), stock-side depth within +10% per pool (quote-agnostic),
// 7-day volume per pool in STOCK units, memecoin-adjacency (non-USDG pool in the top-2 by volume), $50k-swap price
// impact on the deepest hook-free USDG pool, Chainlink feed availability.
// Writes contracts/config/screen.json.
// Deviation (documented in output): SPEC asks for 30-day average pool TVL; the public RPC has no archive state, so depth
// is sampled from the `liquidity` field of the last `--days` of Swap logs plus the current slot.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, parseAbi, type Address, type Hex } from "viem";
import { makeClient, blockAtOrBefore, swapLogs, POOL_MANAGER, type SwapLog } from "../../keeper/src/chain.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const INIT_TOPIC = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438" as Hex;
const Q96 = 1n << 96n;
const pmAbi = parseAbi(["function extsload(bytes32) view returns (bytes32)"]);
const erc20 = parseAbi(["function symbol() view returns (string)"]);

export interface Pool {
  poolId: Hex;
  quote: Address;
  quoteSymbol: string;
  stockIs0: boolean;
  fee: number;
  tickSpacing: number;
  hooks: Address;
  sqrtPriceX96: string;
  liquidity: string;
  stockDepth10: number; // STOCK units available within +10% of the pool's own price
  vol7dStock: number; // |stock leg| traded over the window
  swaps7d: number;
}

/** STOCK (18 dec) held by liquidity L between the current price and +10% (in the pool's own price terms). */
export function stockDepthWithin10(L: bigint, sqrtP: bigint, stockIs0: boolean): number {
  if (L === 0n || sqrtP === 0n) return 0;
  // sqrt(1.1) ~= 1.0488088; k = 1 - 1/sqrt(1.1)
  const K = 46_537n; // 1e6 * (1 - 1/1.0488088)
  const raw = stockIs0 ? (L * Q96 * K) / sqrtP / 1_000_000n : (L * sqrtP * K) / Q96 / 1_000_000n;
  return Number(raw) / 1e18;
}

/** % price impact of buying `usd` worth of STOCK with USDG in a single-tick approximation (active liquidity L). */
export function impactPct(L: bigint, sqrtP: bigint, stockIs0: boolean, usd: number): number {
  if (L === 0n) return Infinity;
  const dUsdg = BigInt(Math.round(usd * 1e6));
  if (stockIs0) {
    // USDG is token1: sqrt rises by dy/L; USD price ~ sqrt^2
    const s1 = sqrtP + (dUsdg * Q96) / L;
    return (Number((s1 * 1_000_000n) / sqrtP) ** 2 / 1e12 - 1) * 100;
  }
  // USDG is token0: 1/sqrt rises by dx/L -> sqrt falls; USD price ~ 1/sqrt^2
  const inv0 = (Q96 * Q96) / sqrtP;
  const inv1 = inv0 + (dUsdg * Q96) / L;
  return (Number((inv1 * 1_000_000n) / inv0) ** 2 / 1e12 - 1) * 100;
}

async function main() {
  const args = process.argv.slice(2);
  const days = Number(args.includes("--days") ? args[args.indexOf("--days") + 1] : 7);
  const c = makeClient();
  const facts = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8"));
  const feeds = new Map<string, string>();
  for (const [t, s] of Object.entries<any>(facts.stocks)) if (s.feed) feeds.set(t, s.feed);
  const reg = (await (await fetch("https://api.robinhood.com/rhj/assets")).json()).assets as any[];
  const stocks = reg
    .map((a) => ({ ticker: a.tokenSymbol as string, token: a.deployments.find((d: any) => d.chainId === 4663)?.contractAddress as Address | undefined }))
    .filter((x): x is { ticker: string; token: Address } => !!x.token);
  console.log(`registry: ${stocks.length} tickers on Robinhood Chain`);

  // ------------------------------------------------------------ pools (Initialize logs, stock on either side)
  const topic = (a: string) => `0x${a.toLowerCase().slice(2).padStart(64, "0")}` as Hex;
  const pools = new Map<string, Pool[]>();
  const symbols = new Map<string, string>([[USDG, "USDG"]]);
  for (const s of stocks) {
    const found: Pool[] = [];
    for (const side of [2, 3]) {
      const topics: (Hex | null)[] = [INIT_TOPIC, null, null, null];
      topics[side] = topic(s.token);
      const logs: any[] = await c.request({
        method: "eth_getLogs",
        params: [{ address: POOL_MANAGER, fromBlock: "0x0", toBlock: "latest", topics: topics.slice(0, side + 1) }],
      } as any);
      for (const l of logs) {
        const d = l.data.slice(2);
        const word = (i: number) => BigInt("0x" + d.slice(i * 64, i * 64 + 64));
        const c0 = ("0x" + l.topics[2].slice(26)) as Address;
        const c1 = ("0x" + l.topics[3].slice(26)) as Address;
        const stockIs0 = c0.toLowerCase() === s.token.toLowerCase();
        let ts = Number(word(1) & 0xffffffn);
        if (ts >= 1 << 23) ts -= 1 << 24;
        found.push({
          poolId: l.topics[1], quote: stockIs0 ? c1 : c0, quoteSymbol: "", stockIs0, fee: Number(word(0)), tickSpacing: ts,
          hooks: ("0x" + d.slice(2 * 64 + 24, 3 * 64)) as Address, sqrtPriceX96: "0", liquidity: "0", stockDepth10: 0, vol7dStock: 0, swaps7d: 0,
        });
      }
    }
    pools.set(s.ticker, found);
    process.stdout.write(`${s.ticker}:${found.length} `);
  }
  console.log();

  // ------------------------------------------------------------ current slot0 + liquidity for every pool (multicall)
  const all = [...pools.values()].flat();
  const slotOf = (id: Hex) => BigInt(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }], [id, 6n])));
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200);
    const res = await c.multicall({
      contracts: chunk.flatMap((p) => [
        { address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const, args: [`0x${slotOf(p.poolId).toString(16).padStart(64, "0")}` as Hex] as const },
        { address: POOL_MANAGER, abi: pmAbi, functionName: "extsload" as const, args: [`0x${(slotOf(p.poolId) + 3n).toString(16).padStart(64, "0")}` as Hex] as const },
      ]),
      allowFailure: true,
    });
    chunk.forEach((p, j) => {
      const w0 = res[2 * j].status === "success" ? BigInt(res[2 * j].result as Hex) : 0n;
      const w3 = res[2 * j + 1].status === "success" ? BigInt(res[2 * j + 1].result as Hex) : 0n;
      p.sqrtPriceX96 = (w0 & ((1n << 160n) - 1n)).toString();
      p.liquidity = (w3 & ((1n << 128n) - 1n)).toString();
      p.stockDepth10 = stockDepthWithin10(BigInt(p.liquidity), BigInt(p.sqrtPriceX96), p.stockIs0);
    });
  }

  // ------------------------------------------------------------ last N days of swaps for the pools that matter
  // top 6 pools per ticker by stock depth, plus every USDG pool with any liquidity
  const tracked: Pool[] = [];
  for (const ps of pools.values()) {
    const live = ps.filter((p) => BigInt(p.liquidity) > 0n);
    const keep = new Set([...live].sort((a, b) => b.stockDepth10 - a.stockDepth10).slice(0, 6));
    for (const p of live) if (p.quote.toLowerCase() === USDG) keep.add(p);
    tracked.push(...keep);
  }
  const now = Number((await c.getBlock()).timestamp);
  const from = await blockAtOrBefore(c, now - days * 86_400);
  const to = await c.getBlockNumber();
  const byId = new Map(tracked.map((p) => [p.poolId.toLowerCase(), p]));
  console.log(`tracking ${tracked.length} pools over ${days}d (${to - from} blocks)`);
  for (let i = 0; i < tracked.length; i += 60) {
    const ids = tracked.slice(i, i + 60).map((p) => p.poolId);
    const logs: SwapLog[] = await swapLogs(c, ids, from, to);
    for (const l of logs) {
      const p = byId.get(l.poolId.toLowerCase())!;
      const leg = p.stockIs0 ? l.amount0 : l.amount1;
      p.vol7dStock += Math.abs(Number(leg)) / 1e18;
      p.swaps7d++;
    }
    process.stdout.write(`.`);
  }
  console.log();

  // ------------------------------------------------------------ per-ticker screen
  for (const p of tracked) {
    const q = p.quote.toLowerCase();
    if (!symbols.has(q)) {
      try {
        symbols.set(q, await c.readContract({ address: p.quote, abi: erc20, functionName: "symbol" }));
      } catch {
        symbols.set(q, q === "0x0000000000000000000000000000000000000000" ? "ETH" : "?");
      }
    }
    p.quoteSymbol = symbols.get(q)!;
  }
  const out: Record<string, any> = {};
  for (const s of stocks) {
    const ps = (pools.get(s.ticker) ?? []).filter((p) => byId.has(p.poolId.toLowerCase()));
    const byVol = [...ps].sort((a, b) => b.vol7dStock - a.vol7dStock);
    const usdgNoHook = ps
      .filter((p) => p.quote.toLowerCase() === USDG && /^0x0{40}$/i.test(p.hooks))
      .sort((a, b) => b.stockDepth10 - a.stockDepth10)[0];
    const top2 = byVol.slice(0, 2).filter((p) => p.vol7dStock > 0);
    out[s.ticker] = {
      token: s.token,
      hasFeed: feeds.has(s.ticker),
      pools: (pools.get(s.ticker) ?? []).length,
      livePools: ps.length,
      vol7dStock: Math.round(byVol.reduce((a, p) => a + p.vol7dStock, 0) * 100) / 100,
      swaps7d: byVol.reduce((a, p) => a + p.swaps7d, 0),
      top2ByVolume: top2.map((p) => ({ quote: p.quoteSymbol, poolId: p.poolId, vol7dStock: Math.round(p.vol7dStock * 100) / 100, hooks: p.hooks })),
      memecoinAdjacent: top2.some((p) => p.quote.toLowerCase() !== USDG),
      bestUsdgPool: usdgNoHook ? usdgNoHook.poolId : null,
      impact50kPct: usdgNoHook ? Math.round(impactPct(BigInt(usdgNoHook.liquidity), BigInt(usdgNoHook.sqrtPriceX96), usdgNoHook.stockIs0, 50_000) * 100) / 100 : null,
      usdgStockDepth10: usdgNoHook ? Math.round(usdgNoHook.stockDepth10 * 100) / 100 : null,
    };
    const o = out[s.ticker];
    o.thin = o.impact50kPct === null || o.impact50kPct > 5;
  }
  const doc = {
    step: "M0.5 stage 1 screen (SPEC §3.5 steps 1-2)",
    generatedAt: new Date().toISOString(),
    windowDays: days,
    deviation: `30-day average TVL not available without archive state; depth = current active liquidity, volume = last ${days}d of Swap logs.`,
    tickers: out,
  };
  writeFileSync(join(ROOT, "contracts/config/screen.json"), JSON.stringify(doc, null, 1) + "\n");
  const flagged = Object.entries<any>(out).filter(([, v]) => v.swaps7d > 0 && (v.thin || v.memecoinAdjacent));
  console.log(`screened ${stocks.length}; active ${Object.values<any>(out).filter((v) => v.swaps7d > 0).length}; flagged thin/meme-adjacent ${flagged.length}`);
  for (const [t, v] of flagged.sort((a, b) => b[1].vol7dStock - a[1].vol7dStock).slice(0, 30)) {
    console.log(`${t.padEnd(6)} feed=${v.hasFeed ? "Y" : "N"} impact50k=${v.impact50kPct}% meme=${v.memecoinAdjacent} top2=${v.top2ByVolume.map((p: any) => p.quote).join("/")} vol7d=${v.vol7dStock}`);
  }
  console.log("wrote contracts/config/screen.json");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
