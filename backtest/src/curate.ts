// M0.5 stage 2-3 (SPEC §3.5 steps 3-4): backtest candidates, bucket majors vs dislocation-prone, pick 3-5 to ship.
//   npm run curate -w backtest [-- --since 2026-07-04 --tickers HIMS,NVDA]
// For every ticker with a hook-free STOCK/USDG pool x every weekend since `--since`, on real v4 Swap logs:
//   P0 (Chainlink Friday close print), max pool premium vs P0, hours >= +10%, premium left at reopen,
//   pool depth (USD to move +10%), and a full simulated vault epoch (ladder-free single band, lock variant, ex-fees).
// Writes contracts/config/tickers.json (bucket + evidence per ticker + the 3-5 v1 picks) and docs/curation.md.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex } from "viem";
import { makeClient, feedAbi, blockAtOrBefore, swapLogs, lastSwapBefore, type Round, type SwapLog } from "../../keeper/src/chain.js";
import { EpochSim, DEFAULT_PARAMS, type TickerCfg } from "../../keeper/src/engine.js";
import { usdToSqrtPriceX96, sqrtPriceX96ToUsd } from "../../keeper/src/rangeMath.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DAY = 86_400;
const D8 = { feed: 8, stock: 18, usd: 6 };
const NOTIONAL_USD = 10_000; // simulated deployment per ticker-weekend

// ---------------------------------------------------------------- classification (SPEC §3.5 step 3)
export const RULES = {
  dislocationPct: 15, // SPEC: "repeated >15% weekend swings"
  minDislocatedWeekends: 2, // "repeated" = at least 2 weekends in the sample
  majorMaxPct: 5, // majors: never above +5% (the vault would rarely arm-fill: correct behaviour)
  squeezePct: 10, // default band start, reported as "triggered"
  minSwapsPerWeekend: 5, // below this the pool is too dead to trust its prints
};

export type Bucket = "dislocation-prone" | "major" | "neither" | "ineligible";

export interface WeekendEvidence {
  weekend: string; // Saturday date
  p0: number | null;
  p0Source: "chainlink" | "pool-fri-close";
  swaps: number;
  maxPremiumPct: number | null;
  hoursAbove10: number;
  premiumAtReopenPct: number | null;
  depthUsdTo10pct: number | null;
  vaultVsHodlPctExFees: number | null; // lockOnFill variant
  specVsHodlPctExFees: number | null; // hold-to-settle variant
  note?: string;
}

/** Saturdays 00:00 UTC on/after `since` whose settle point (Mon 01:00) is already in the past. */
export function saturdays(since: number, now: number): number[] {
  const day0 = since - (since % DAY);
  const dow = (Math.floor(day0 / DAY) + 4) % 7; // 0 Sun .. 6 Sat
  const out: number[] = [];
  for (let sat = day0 + ((6 - dow + 7) % 7) * DAY; sat + 2 * DAY + 3600 <= now; sat += 7 * DAY) out.push(sat);
  return out;
}

export const CONTROLS = ["NVDA", "SPY", "AAPL"]; // majors, backtested as controls (SPEC §3.5 step 3)
export const FLAGSHIP_NO_FEED = ["HIMS"]; // evidence only: no Chainlink feed

/** Stage-2 candidates: flagged (thin or memecoin-adjacent) tickers that CAN ship (feed + hook-free USDG pool), top 6 by
 *  7-day volume, plus the no-feed flagship and the major controls. */
/** Meme-adjacent = a top-2 pool (by volume) quoted in something that is not USDG, ETH/WETH or another stock token.
 *  (A literal "non-USDG" reading of SPEC §3.5 would flag TSLA/SPY or GOOGL/ETH pools, which are not memecoins.) */
export function memeAdjacent(v: any, stockTickers: Set<string>): boolean {
  return (v.top2ByVolume ?? []).some((p: any) => !["USDG", "ETH", "WETH"].includes(p.quote) && !stockTickers.has(p.quote));
}

export function pickCandidates(screen: any, facts: any, n = 6): string[] {
  const stocks = new Set(Object.keys(screen.tickers));
  const flagged = Object.entries<any>(screen.tickers)
    .filter(([t, v]) => v.swaps7d > 0 && (v.thin || memeAdjacent(v, stocks)) && facts.stocks[t]?.feed && facts.stocks[t]?.bestNoHookPool)
    .sort((a, b) => b[1].vol7dStock - a[1].vol7dStock)
    .slice(0, n)
    .map(([t]) => t);
  const extra = [...FLAGSHIP_NO_FEED, ...CONTROLS].filter((t) => facts.stocks[t]?.bestNoHookPool);
  return [...new Set([...flagged, ...extra])];
}

/** Pure classification of one ticker's weekend evidence (unit-tested). Shippability (feed) is decided separately. */
export function classify(ev: WeekendEvidence[]): { bucket: Bucket; reason: string; dislocated: number; worst: number } {
  const usable = ev.filter((w) => w.maxPremiumPct !== null && w.swaps >= RULES.minSwapsPerWeekend);
  const dislocated = usable.filter((w) => w.maxPremiumPct! > RULES.dislocationPct).length;
  const worst = Math.max(0, ...usable.map((w) => w.maxPremiumPct!));
  if (usable.length === 0) return { bucket: "ineligible", reason: "no usable weekend data (pool too inactive)", dislocated, worst };
  if (dislocated >= RULES.minDislocatedWeekends) {
    return { bucket: "dislocation-prone", reason: `${dislocated}/${usable.length} weekends > +${RULES.dislocationPct}%, max +${worst.toFixed(1)}%`, dislocated, worst };
  }
  if (worst < RULES.majorMaxPct) {
    return { bucket: "major", reason: `max weekend premium +${worst.toFixed(1)}% (< ${RULES.majorMaxPct}%): near-zero fills expected`, dislocated, worst };
  }
  return { bucket: "neither", reason: `max +${worst.toFixed(1)}%, ${dislocated} weekend(s) > +${RULES.dislocationPct}% (needs >= ${RULES.minDislocatedWeekends})`, dislocated, worst };
}

// ---------------------------------------------------------------- data collection

export async function feedRounds(c: ReturnType<typeof makeClient>, feed: Address, since: number): Promise<Round[]> {
  const [latestId] = await c.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" });
  const phaseStart = (latestId >> 64n) << 64n;
  const out: Round[] = [];
  for (let hi = latestId; hi > phaseStart; ) {
    const ids: bigint[] = [];
    for (let i = 0n; i < 150n && hi - i > phaseStart; i++) ids.push(hi - i);
    const res = await c.multicall({
      contracts: ids.map((id) => ({ address: feed, abi: feedAbi, functionName: "getRoundData" as const, args: [id] as const })),
      allowFailure: true,
    });
    let older = false;
    for (const r of res) {
      if (r.status !== "success") continue;
      const [roundId, answer, , updatedAt] = r.result as readonly [bigint, bigint, bigint, bigint, bigint];
      if (updatedAt === 0n) continue;
      out.push({ roundId, answer, updatedAt: Number(updatedAt) });
      if (Number(updatedAt) < since) older = true;
    }
    if (older) break;
    hi -= BigInt(ids.length);
  }
  return out.sort((a, b) => a.updatedAt - b.updatedAt);
}

const usdOf = (sq: bigint, s0: boolean) => Number(sqrtPriceX96ToUsd(sq, D8, s0)) / 1e8;

/** USD of USDG needed to push the pool from p to p*1.1 with active liquidity L (single-tick approximation). */
function depthTo10(L: bigint, p: number, s0: boolean): number {
  const a = usdToSqrtPriceX96(BigInt(Math.round(p * 1e8)), D8, s0);
  const b = usdToSqrtPriceX96(BigInt(Math.round(p * 1.1 * 1e8)), D8, s0);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  // USDG is token1 when stock is currency0 (amount1 = L*dS/Q96), token0 otherwise (amount0 = L*Q96*dS/(lo*hi))
  const raw = s0 ? (L * (hi - lo)) >> 96n : ((L << 96n) * (hi - lo)) / lo / hi;
  return Number(raw) / 1e6;
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const since = Math.floor(Date.parse(`${opt("--since") ?? "2026-07-04"}T00:00:00Z`) / 1000);
  const facts = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8"));
  let only = opt("--tickers")?.split(",");
  if (args.includes("--from-screen")) {
    const screen = JSON.parse(readFileSync(join(ROOT, "contracts/config/screen.json"), "utf8"));
    only = pickCandidates(screen, facts);
    console.log(`candidates from screen: ${only.join(", ")}`);
  }
  const tickers = Object.keys(facts.stocks).filter((t) => facts.stocks[t].bestNoHookPool && (!only || only.includes(t))).sort();
  const c = makeClient();
  const nowTs = Number((await c.getBlock()).timestamp);

  const weekends = saturdays(since, nowTs);
  console.log(`curating ${tickers.length} tickers x ${weekends.length} weekends (${new Date(weekends[0] * 1000).toISOString().slice(0, 10)} .. ${new Date(weekends.at(-1)! * 1000).toISOString().slice(0, 10)})`);

  const cfgs: Record<string, TickerCfg> = {};
  for (const t of tickers) {
    const s = facts.stocks[t];
    cfgs[t] = {
      ticker: t, stock: s.token, feed: s.feed, feedDecimals: s.feedDecimals ?? 8, stockIsCurrency0: s.stockIsCurrency0,
      poolId: s.bestNoHookPool.poolId, fee: s.bestNoHookPool.poolKey.fee, tickSpacing: s.bestNoHookPool.poolKey.tickSpacing,
    };
  }
  const rounds: Record<string, Round[]> = {};
  const evCachePre = join(ROOT, `backtest/.cache/evidence-${weekends[0]}-${weekends.at(-1)}.json`);
  const pre: Record<string, unknown> = existsSync(evCachePre) ? JSON.parse(readFileSync(evCachePre, "utf8")) : {};
  const needAny = (t: string) => !pre[t];
  for (const t of tickers) {
    if (!cfgs[t].feed || !needAny(t)) continue;
    rounds[t] = await feedRounds(c, cfgs[t].feed as Address, weekends[0] - 3 * DAY);
    process.stdout.write(`feed ${t}: ${rounds[t].length} rounds\n`);
  }

  const evidence: Record<string, WeekendEvidence[]> = Object.fromEntries(tickers.map((t) => [t, []]));
  const evCache = join(ROOT, `backtest/.cache/evidence-${weekends[0]}-${weekends.at(-1)}.json`);
  const cached: Record<string, WeekendEvidence[]> = existsSync(evCache) ? JSON.parse(readFileSync(evCache, "utf8")) : {};
  const need = tickers.filter((t) => !cached[t]);
  for (const t of tickers) if (cached[t]) evidence[t] = cached[t];
  if (need.length) console.log(`backtesting ${need.length} ticker(s); ${tickers.length - need.length} from cache`);
  const partialPath = join(ROOT, `backtest/.cache/partial-${weekends[0]}-${weekends.at(-1)}-${need.join("_").slice(0, 80)}.json`);
  const partial: Record<string, Record<string, WeekendEvidence>> = existsSync(partialPath) ? JSON.parse(readFileSync(partialPath, "utf8")) : {};
  for (const sat of need.length ? weekends : []) {
    const wk = new Date(sat * 1000).toISOString().slice(0, 10);
    if (partial[wk]) {
      for (const t of need) evidence[t].push(partial[wk][t]);
      process.stdout.write(`weekend ${wk}: from partial cache\n`);
      continue;
    }
    const fri20 = sat - 4 * 3600;
    const mon = sat + 2 * DAY;
    const [bFri, bSat, bEnd] = [await blockAtOrBefore(c, fri20), await blockAtOrBefore(c, sat), await blockAtOrBefore(c, mon + 3600)];
    const ids = need.map((t) => cfgs[t].poolId as Hex);
    const logs = await swapLogs(c, ids, bFri, bEnd);
    const byPool = new Map<string, SwapLog[]>();
    for (const l of logs) (byPool.get(l.poolId.toLowerCase()) ?? byPool.set(l.poolId.toLowerCase(), []).get(l.poolId.toLowerCase())!).push(l);
    process.stdout.write(`weekend ${new Date(sat * 1000).toISOString().slice(0, 10)}: ${logs.length} swaps\n`);

    for (const t of need) {
      const cfg = cfgs[t];
      const s0 = cfg.stockIsCurrency0;
      const pl = byPool.get(cfg.poolId.toLowerCase()) ?? [];
      const before = pl.filter((l) => l.ts < sat).at(-1) ?? (await lastSwapBefore(c, cfg.poolId as Hex, bSat));
      const inWin = pl.filter((l) => l.ts >= sat && l.ts < mon);
      const w: WeekendEvidence = {
        weekend: new Date(sat * 1000).toISOString().slice(0, 10), p0: null, p0Source: "chainlink", swaps: inWin.length,
        maxPremiumPct: null, hoursAbove10: 0, premiumAtReopenPct: null, depthUsdTo10pct: null,
        vaultVsHodlPctExFees: null, specVsHodlPctExFees: null,
      };
      evidence[t].push(w);
      if (!before) {
        w.note = "no pool activity before the window";
        continue;
      }
      let p0: number;
      const r = rounds[t]?.filter((x) => x.updatedAt <= sat).at(-1);
      if (r) p0 = Number(r.answer) / 1e8;
      else {
        const fri = pl.filter((l) => l.ts <= fri20).at(-1) ?? before;
        p0 = usdOf(fri.sqrtPriceX96, s0);
        w.p0Source = "pool-fri-close";
      }
      w.p0 = Math.round(p0 * 1e4) / 1e4;
      w.depthUsdTo10pct = before.liquidity > 0n ? Math.round(depthTo10(before.liquidity, usdOf(before.sqrtPriceX96, s0), s0)) : 0;
      // premium path (zero-liquidity drain prints excluded)
      let prevT = sat;
      let prevPrem = usdOf(before.sqrtPriceX96, s0) / p0 - 1;
      let maxPrem = prevPrem;
      let above = 0;
      for (const l of inWin) {
        if (prevPrem >= 0.1) above += l.ts - prevT;
        prevT = l.ts;
        if (l.liquidity === 0n) continue;
        prevPrem = usdOf(l.sqrtPriceX96, s0) / p0 - 1;
        maxPrem = Math.max(maxPrem, prevPrem);
      }
      if (prevPrem >= 0.1) above += mon - prevT;
      w.maxPremiumPct = Math.round(maxPrem * 1e4) / 100;
      w.hoursAbove10 = Math.round((above / 3600) * 10) / 10;
      const atReopen = pl.filter((l) => l.ts <= mon && l.liquidity > 0n).at(-1) ?? before;
      w.premiumAtReopenPct = Math.round((usdOf(atReopen.sqrtPriceX96, s0) / p0 - 1) * 1e4) / 100;

      // simulated epoch: ~$10k deployed, default band, settle at Mon 01:00 at the pool price (fresh ~= pool)
      const q = Math.max(1, Math.round(NOTIONAL_USD / p0));
      const sim = new EpochSim({ ...cfg, feedDecimals: 8 }, { ...DEFAULT_PARAMS, quantities: [q] }, sat, mon);
      sim.doArm({ time: sat + 300, block: bSat, p0: BigInt(Math.round(p0 * 1e8)), p0Source: "chainlink", feedUpdatedAt: r?.updatedAt ?? null, sqrtPriceX96: before.sqrtPriceX96, tick: before.tick });
      if (sim.status !== "armed") {
        w.note = sim.skipReason ?? "not armed";
        continue;
      }
      for (const l of pl.filter((l) => l.ts >= sat && l.ts <= mon + 3600)) sim.ingest(l);
      const settleLog = pl.filter((l) => l.ts <= mon + 3600 && l.liquidity > 0n).at(-1) ?? before;
      const fresh = rounds[t]?.find((x) => x.updatedAt >= mon);
      const freshPx = fresh ? fresh.answer : BigInt(Math.round(usdOf(settleLog.sqrtPriceX96, s0) * 1e8));
      sim.doSettle({ time: mon + 3600, block: bEnd, fresh: freshPx, freshSource: fresh ? "chainlink" : "pool", freshUpdatedAt: fresh?.updatedAt ?? null, sqrtPriceX96: settleLog.sqrtPriceX96 });
      w.vaultVsHodlPctExFees = sim.settlement.results.lockOnFill[0].vsHodlPctExFees;
      w.specVsHodlPctExFees = sim.settlement.results.spec[0].vsHodlPctExFees;
      if (!sim.settlement.buybackPossible) w.note = "buyback capped: would end PENDING_BUYBACK";
    }
    partial[wk] = Object.fromEntries(need.map((t) => [t, evidence[t].at(-1)!]));
    mkdirSync(dirname(partialPath), { recursive: true });
    writeFileSync(partialPath, JSON.stringify(partial));
  }

  if (need.length) {
    mkdirSync(dirname(evCache), { recursive: true });
    writeFileSync(evCache, JSON.stringify({ ...cached, ...Object.fromEntries(need.map((t) => [t, evidence[t]])) }));
  }
  if (args.includes("--collect-only")) {
    console.log(`evidence cached: ${evCache}`);
    return;
  }

  // ---------------------------------------------------------------- output
  const out: Record<string, any> = {};
  for (const t of tickers) {
    const ev = evidence[t];
    const { bucket, reason, dislocated } = classify(ev);
    const hasFeed = !!cfgs[t].feed;
    const pct = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);
    const vs = pct(ev.map((w) => w.vaultVsHodlPctExFees));
    out[t] = {
      bucket,
      hasFeed,
      // shippable = dislocation-prone AND a Chainlink feed exists (vault oracle checks) AND a hook-free USDG pool (all here)
      shippable: bucket === "dislocation-prone" && hasFeed,
      ship: false, // set below: the 3-5 picked for v1
      reason: hasFeed || bucket !== "dislocation-prone" ? reason : `${reason}; NOT shippable: no Chainlink feed on Robinhood mainnet`,
      token: cfgs[t].stock,
      feed: cfgs[t].feed,
      poolId: cfgs[t].poolId,
      stockIsCurrency0: cfgs[t].stockIsCurrency0,
      summary: {
        weekends: ev.length,
        triggered: ev.filter((w) => (w.maxPremiumPct ?? 0) >= RULES.squeezePct).length,
        dislocated,
        maxPremiumPct: Math.max(0, ...pct(ev.map((w) => w.maxPremiumPct))),
        medianMaxPremiumPct: median(pct(ev.map((w) => w.maxPremiumPct))),
        vaultAvgVsHodlPctExFees: vs.length ? Math.round((vs.reduce((a, b) => a + b, 0) / vs.length) * 1e4) / 1e4 : null,
        vaultCumulativeVsHodlPctExFees: vs.length ? Math.round((vs.reduce((a, b) => a * (1 + b / 100), 1) - 1) * 1e6) / 1e4 : null,
        medianDepthUsdTo10pct: median(pct(ev.map((w) => w.depthUsdTo10pct))),
      },
      evidence: ev,
    };
  }
  // v1 ships the 3-5 best shippable tickers by simulated vault result (ex-fees); never padded with non-qualifiers
  const picks = Object.entries<any>(out)
    .filter(([, v]) => v.shippable)
    .sort((a, b) => (b[1].summary.vaultCumulativeVsHodlPctExFees ?? 0) - (a[1].summary.vaultCumulativeVsHodlPctExFees ?? 0))
    .slice(0, 5)
    .map(([t]) => t);
  for (const t of picks) out[t].ship = true;
  const doc = {
    method: "SPEC §3.5 v1",
    methodNote:
      picks.length >= 3
        ? `${picks.length} dislocation-prone tickers with a Chainlink feed selected for v1.`
        : `ONLY ${picks.length} shippable dislocation-prone ticker(s) found (SPEC asks for 3-5). Not padded: see docs/curation.md.`,
    ship: picks,
    generatedAt: new Date().toISOString(),
    rules: RULES,
    notionalUsdPerEpoch: NOTIONAL_USD,
    weekends: weekends.map((s) => new Date(s * 1000).toISOString().slice(0, 10)),
    tickers: out,
  };
  writeFileSync(join(ROOT, "contracts/config/tickers.json"), JSON.stringify(doc, null, 1) + "\n");
  writeFileSync(join(ROOT, "docs/curation.md"), markdown(doc));
  const counts: Record<string, string[]> = {};
  for (const [t, v] of Object.entries(out)) (counts[v.bucket] ??= []).push(t);
  console.log(JSON.stringify(counts, null, 1));
  console.log("wrote contracts/config/tickers.json and docs/curation.md");
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100;
}

function markdown(doc: any): string {
  const order: Record<string, number> = { "dislocation-prone": 0, neither: 1, major: 2, ineligible: 3 };
  const rows = Object.entries<any>(doc.tickers).sort(
    (a, b) => order[a[1].bucket] - order[b[1].bucket] || (b[1].summary.maxPremiumPct ?? 0) - (a[1].summary.maxPremiumPct ?? 0),
  );
  const r = doc.rules;
  return `# Ticker curation (M0.5, SPEC §3.5)

**Ship for v1: ${doc.ship.length ? doc.ship.join(", ") : "none"}.** ${doc.methodNote}

Generated ${doc.generatedAt} from real Uniswap v4 swap logs on Robinhood Chain mainnet (deepest hook-free STOCK/USDG pool
per ticker) and Chainlink feed history. Weekends: ${doc.weekends[0]} .. ${doc.weekends.at(-1)} (${doc.weekends.length}). Candidates come from the
registry-wide screen in \`contracts/config/screen.json\` (thin = $50k swap moves the USDG pool > 5%, memecoin-adjacent =
a non-USDG pool in the top-2 by 7-day volume), plus majors as controls.

**Buckets:** *dislocation-prone* = > +${r.dislocationPct}% over P0 (Friday Chainlink close) on >= ${r.minDislocatedWeekends} weekends.
*major* = never above +${r.majorMaxPct}%: near-zero fills, which is correct behaviour. *neither* = in between. Weekends with
< ${r.minSwapsPerWeekend} swaps are ignored. **Shippable** additionally needs a Chainlink feed (vault oracle checks).
Vault column: simulated epoch, about $${doc.notionalUsdPerEpoch.toLocaleString()} deployed, default single band P0 x 1.10..1.60,
lock variant, ex-LP-fees, compounded over the sample. Hypothetical: it assumes the vault does not move the price.

| Ticker | Bucket | Feed | Ship | > +15% weekends | Max premium | Median max | Vault cum. vs HODL (ex-fees) | Median depth to +10% | Reason |
|---|---|---|---|---|---|---|---|---|---|
${rows
  .map(([t, v]) => `| ${t} | **${v.bucket}** | ${v.hasFeed ? "yes" : "no"} | ${v.ship ? "✅" : ""} | ${v.summary.dislocated}/${v.summary.weekends} | +${v.summary.maxPremiumPct}% | +${v.summary.medianMaxPremiumPct ?? "–"}% | ${v.summary.vaultCumulativeVsHodlPctExFees ?? "–"}% | $${(v.summary.medianDepthUsdTo10pct ?? 0).toLocaleString()} | ${v.reason} |`)
  .join("\n")}
`;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
