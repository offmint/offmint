// "With our own supply" replay over the weekend screen (docs/AIRTIGHT.md item 7, docs/TAILOR.md Phase 1).
//   npm run supply -w backtest [-- --min-premium 5 --only HIMS]
// For every screened (ticker, weekend) whose logged peak premium reaches --min-premium (default 5%; the first rung starts
// at +8%, so below that neither mode can fill), rebuild the ticker's pool from its full ModifyLiquidity history, arm the
// contract's default ladder at Sat 00:05 UTC, replay every logged swap until Mon 01:00 UTC and settle with the capped
// buyback. Reports raw (no impact) and with-supply side by side, for several holding sizes.
// Writes web/public/data/supply/replay.json. Read-only mainnet; logs cached in backtest/.cache/modliq/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, toHex, decodeAbiParameters, type Address, type Hex } from "viem";
import { makeClient, logClient, blockAtOrBefore, swapLogs, lastSwapBefore, POOL_MANAGER, isRateLimited, backoff, type Round } from "../../keeper/src/chain.js";
import { replayWeekend, type PoolEvent, type LadderParams } from "../../keeper/src/supplyReplay.js";
import { feedRounds } from "./curate.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DAY = 86_400;
const MODIFY_TOPIC = keccak256(toHex("ModifyLiquidity(bytes32,address,int24,int24,int256,bytes32)"));
const SIZES = [1_000, 10_000, 100_000];
const HEADLINE_SIZE = 10_000;
// arm (~0.4M gas, testnet) + lock (~0.5M) + settle (~0.3M) at ~0.04 gwei is ~$0.20; charged at $1 to stay conservative
const GAS_USD = 1;

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const minPremium = Number(opt("--min-premium", "5"));
const only = opt("--only")?.split(",");

const params = JSON.parse(readFileSync(join(ROOT, "web/public/data/params.json"), "utf8"));
const LADDER: LadderParams = {
  rungs: params.ladder,
  deployBps: params.vault.defaultDeployBps,
  buybackSlippageBps: params.vault.buybackSlippageBps,
  perfFeeBps: params.vault.perfFeeBps,
  lockLead: 15 * 60,
};

const screen = JSON.parse(readFileSync(join(ROOT, "web/public/data/screen/weekends.json"), "utf8"));
const tk: Record<string, any> = {};
for (const f of ["tickers-allfeeds.json", "tickers-nofeed.json", "tickers.json"]) Object.assign(tk, JSON.parse(readFileSync(join(ROOT, "contracts/config", f), "utf8")).tickers);
const detector = JSON.parse(readFileSync(join(ROOT, "contracts/config/.detector-cache.json"), "utf8")).pools as Record<string, any[]>;
const poolMeta = (t: string) => {
  const pid = String(tk[t].poolId).toLowerCase();
  const m = (detector[String(tk[t].token).toLowerCase()] ?? []).find((p) => p.poolId.toLowerCase() === pid);
  if (!m) throw new Error(`${t}: pool ${pid} not in detector cache`);
  if (m.hooks !== "0x0000000000000000000000000000000000000000") throw new Error(`${t}: pool has a hook`);
  return { poolId: pid as Hex, stockIs0: !!m.stockIs0, tickSpacing: Number(m.tickSpacing), createdBlock: BigInt(m.createdBlock) };
};

const c = makeClient();

type Mod = { block: bigint; logIndex: number; tickLower: number; tickUpper: number; liquidityDelta: bigint };
/** Every ModifyLiquidity on the pool from creation to `to`, cached incrementally. */
async function modifies(poolId: Hex, from: bigint, to: bigint): Promise<Mod[]> {
  const path = join(ROOT, `backtest/.cache/modliq/${poolId}.json`);
  const cache: { to: string; logs: [string, number, number, number, string][] } = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { to: (from - 1n).toString(), logs: [] };
  let start = BigInt(cache.to) + 1n;
  let chunk = 400_000n;
  let limited = 0;
  while (start <= to) {
    const end = start + chunk - 1n > to ? to : start + chunk - 1n;
    let raw: any[];
    try {
      raw = (await logClient().request({ method: "eth_getLogs", params: [{ address: POOL_MANAGER, fromBlock: toHex(start), toBlock: toHex(end), topics: [MODIFY_TOPIC, poolId] }] } as any)) as any[];
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
    if (chunk < 400_000n) chunk *= 2n;
    for (const l of raw) {
      const [tl, tu, dl] = decodeAbiParameters([{ type: "int24" }, { type: "int24" }, { type: "int256" }, { type: "bytes32" }], l.data);
      cache.logs.push([BigInt(l.blockNumber).toString(), Number(l.logIndex), Number(tl), Number(tu), (dl as bigint).toString()]);
    }
    cache.to = end.toString();
    start = end + 1n;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cache));
  return cache.logs.map(([b, i, tl, tu, dl]) => ({ block: BigInt(b), logIndex: i, tickLower: tl, tickUpper: tu, liquidityDelta: BigInt(dl) }));
}

const rounds: Record<string, Round[]> = {};
const events: any[] = [];
let zero = 0;
const allRows = Object.entries<any[]>(screen.tickers).flatMap(([t, ws]) => ws.map((w) => ({ t, w })));
const todo = allRows.filter(({ t, w }) => (w.maxPremiumPct ?? -1) >= minPremium && (!only || only.includes(t)));
zero = allRows.filter(({ w }) => w.maxPremiumPct !== null && w.maxPremiumPct < minPremium).length;
console.error(`${allRows.length} screened ticker-weekends; replaying ${todo.length} with a logged peak >= +${minPremium}%`);

// Each finished event is cached (keyed by the engine source + ladder), so a network blip never loses finished work.
const ENGINE = createHash("sha256").update(["poolSim", "supplyReplay"].map((f) => readFileSync(join(ROOT, `keeper/src/${f}.ts`), "utf8")).join("") + JSON.stringify(LADDER) + SIZES.join() + GAS_USD).digest("hex").slice(0, 12);
/** Everything the engine needs for one event, fetched from chain once and cached (engine-independent). */
async function fetchInput(t: string, w: any) {
  const path = join(ROOT, `backtest/.cache/supply-inputs/${t}-${w.weekend}.json`);
  const big = (_: string, v: any) => (typeof v === "string" && /^-?\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"), big);
  const pm = poolMeta(t);
  const sat = Math.floor(Date.parse(`${w.weekend}T00:00:00Z`) / 1000);
  const mon = sat + 2 * DAY;
  const armTime = sat + 300;
  const settleTime = mon + 3600;
  const [armBlock, settleBlock] = [await blockAtOrBefore(c, armTime), await blockAtOrBefore(c, settleTime)];
  const mods = await modifies(pm.poolId, pm.createdBlock, settleBlock);
  const atArm = await lastSwapBefore(c, pm.poolId, armBlock);
  if (!atArm) throw new Error(`${t} ${w.weekend}: no swap before arm`);
  const sw = await swapLogs(c, [pm.poolId], armBlock + 1n, settleBlock);
  const evs: PoolEvent[] = [
    ...mods.filter((m) => m.block > armBlock).map((m) => ({ kind: "modify" as const, ...m })),
    ...sw.map((s) => ({ kind: "swap" as const, block: s.block, logIndex: s.logIndex, ts: s.ts, amount0: s.amount0, amount1: s.amount1, sqrtPriceX96: s.sqrtPriceX96, liquidity: s.liquidity, fee: s.fee })),
  ].sort((a, b) => (a.block === b.block ? a.logIndex - b.logIndex : a.block < b.block ? -1 : 1));
  const settleLog = sw.filter((s) => s.liquidity > 0n).at(-1) ?? atArm;
  let fresh: number, freshSource: string;
  if (tk[t].feed) {
    rounds[t] ??= await feedRounds(c, tk[t].feed as Address, sat - 30 * DAY);
    const r = rounds[t].find((x) => x.updatedAt >= mon);
    if (!r) throw new Error(`${t}: no feed round after ${w.weekend} reopen`);
    [fresh, freshSource] = [Number(r.answer) / 1e8, "chainlink first round after reopen"];
  } else {
    const s = Number(settleLog.sqrtPriceX96) / 2 ** 96;
    [fresh, freshSource] = [pm.stockIs0 ? s * s * 1e12 : 1e12 / (s * s), "pool price at Mon 01:00 UTC (no feed)"];
  }
  const base = {
    stockIs0: pm.stockIs0, tickSpacing: pm.tickSpacing, p0Usd: w.p0, freshUsd: fresh, windowStart: sat, windowEnd: mon, armTime, settleTime,
    armSqrtPriceX96: atArm.sqrtPriceX96, baseBefore: mods.filter((m) => m.block <= armBlock), events: evs, settleSqrtPriceX96: settleLog.sqrtPriceX96, gasUsd: GAS_USD,
  };
  const input = { base, fresh, freshSource, armBlock, settleBlock, swaps: sw.length, liquidityChanges: evs.length - sw.length, armLiquidity: atArm.liquidity, pm };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(input, (_, v) => (typeof v === "bigint" ? `${v}n` : v)));
  return input;
}

async function replayOne(t: string, w: any) {
  const { base, fresh, freshSource, armBlock, settleBlock, swaps, liquidityChanges, armLiquidity, pm } = await fetchInput(t, w);
  const bySize: Record<string, any> = {};
  let validation: any = null;
  for (const size of SIZES) {
    const r = replayWeekend({ ...base, holdingUsd: size }, LADDER);
    bySize[size] = { skipped: r.skipped, raw: r.raw, supply: r.supply };
    validation ??= { ...r.validation, armActiveLiquidityLogged: armLiquidity.toString() };
  }
  const h = bySize[HEADLINE_SIZE];
  console.error(`${t} ${w.weekend}: logged peak +${w.maxPremiumPct}% | $10k raw ${h.raw?.excessPct ?? "-"}% supply ${h.supply?.excessPct ?? "-"}% (peak w/ supply +${h.supply?.peakPremiumPct ?? "-"}%) | shadow err ${validation.maxLogPriceErrPct}%`);
  return {
    ticker: t, weekend: w.weekend, p0: w.p0, p0Source: w.p0Source, fresh: Math.round(fresh * 1e4) / 1e4, freshSource,
    loggedPeakPremiumPct: w.maxPremiumPct, poolId: pm.poolId, stockIsCurrency0: pm.stockIs0, tickSpacing: pm.tickSpacing,
    blocks: { arm: armBlock.toString(), settle: settleBlock.toString() }, swaps, liquidityChanges, validation, bySize,
  };}
for (const { t, w } of todo) {
  const cachePath = join(ROOT, `backtest/.cache/supply-events/${ENGINE}-${t}-${w.weekend}.json`);
  if (existsSync(cachePath)) {
    events.push(JSON.parse(readFileSync(cachePath, "utf8")));
    console.error(`${t} ${w.weekend}: from cache`);
    continue;
  }
  for (let attempt = 1; ; attempt++) {
    try {
      const ev = await replayOne(t, w);
      mkdirSync(dirname(cachePath), { recursive: true });
      writeFileSync(cachePath, JSON.stringify(ev));
      events.push(ev);
      break;
    } catch (e: any) {
      if (attempt >= 3) throw e;
      console.error(`${t} ${w.weekend}: attempt ${attempt} failed (${e?.shortMessage ?? e?.message}); retrying in 30 s`);
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

// totals per size: the sample's sum of excess USD and the mean excess % per ticker-weekend (zero weekends included)
const n = allRows.filter(({ w }) => w.maxPremiumPct !== null).length;
const totals = Object.fromEntries(SIZES.map((s) => {
  const sum = (mode: "raw" | "supply", k: string) => events.reduce((a, e) => a + (e.bySize[s][mode]?.[k] ?? 0), 0);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return [s, {
    rawExcessUsd: r2(sum("raw", "excessUsd")), supplyExcessUsd: r2(sum("supply", "excessUsd")),
    rawMeanExcessPctPerTickerWeekend: r2(sum("raw", "excessPct") / n), supplyMeanExcessPctPerTickerWeekend: r2(sum("supply", "excessPct") / n),
    rawBuyersPaidAboveReferenceUsd: r2(sum("raw", "buyersPaidAboveReferenceUsd")), supplyBuyersPaidAboveReferenceUsd: r2(sum("supply", "buyersPaidAboveReferenceUsd")),
    rawExcessUsdExLpFees: r2(sum("raw", "excessUsd")),
    supplyExcessUsdExLpFees: r2(events.reduce((a, e) => a + (e.bySize[s].supply ? (e.bySize[s].supply.excessPctExLpFees * s) / 100 : 0), 0)),
    supplyPendingUsdgUsd: r2(sum("supply", "usdgLeft")),
    nonzeroSupplyEvents: events.filter((e) => Math.abs(e.bySize[s].supply?.extraShares ?? 0) > 1e-9).length,
  }];
}));
const out = {
  generatedAt: new Date().toISOString(),
  label: "simulated",
  source: "backtest/src/supply.ts over web/public/data/screen/weekends.json; pools rebuilt from their full onchain ModifyLiquidity history (Robinhood Chain mainnet)",
  method: [
    `Default ladder from contracts (${LADDER.rungs.map((r) => `+${r.premiumBps / 100}-${(r.premiumBps + r.widthBps) / 100}%`).join(", ")}), ${LADDER.deployBps / 100}% of the holding deployed, armed Sat 00:05 UTC above p0.`,
    "raw: rungs marked along the logged price path (assumes we move nothing). supply: rungs are real liquidity in a rebuilt pool; each logged swap's input is re-run through it.",
    "A rung is pulled when fully sold (lock) and every rung is pulled 15 min before reopen; buyback at Mon 01:00 UTC as one swap capped at fresh x 1.01, unfilled USDG marked at fresh.",
    "Before the buyback the rebuilt pool is resynced to the logged Monday price (minting is back on, arbitrage restores NAV).",
    `Costs: pool fee on every swap, our own price impact on the buyback, 10% performance fee on gains, $${GAS_USD} gas per armed weekend.`,
    "Assumption: traders send the same input amount they sent historically. Real buyers facing a smaller spike might buy more or less.",
  ],
  ladder: LADDER, sizesUsd: SIZES, headlineSizeUsd: HEADLINE_SIZE, gasUsdPerWeekend: GAS_USD, minPremiumReplayedPct: minPremium,
  screenedTickerWeekends: n, belowThresholdZero: zero, totals, events,
};
const outPath = join(ROOT, only ? `backtest/.cache/supply-${only.join("_")}.json` : "web/public/data/supply/replay.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(JSON.stringify(totals, null, 1));
console.log(`wrote ${outPath}`);
