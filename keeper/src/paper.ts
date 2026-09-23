// Offmint paper mode (SPEC §8): read-only on Robinhood mainnet, no key.
//   npm run paper                      live: every 60s, advance this weekend's hypothetical epoch per ticker
//   npm run replay -- 2026-09-19       replay the weekend window containing / following that date
//   options: --tickers TSLA,NVDA  --out ../web/public/paper
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { makeClient, feedHistory, roundAt, blockAtOrBefore, swapLogs, lastSwapBefore, stockAbi, type Client, type Round, type SwapLog } from "./chain.js";
import { EpochSim, DEFAULT_PARAMS, type Params, type TickerCfg } from "./engine.js";
import { windowStart as clockStart, isoDate, iso } from "./clock.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DAY = 86_400;

// ------------------------------------------------------------------ config

interface KeeperConfig {
  sessionOffset: number;
  params: Partial<Params>;
  premiumTable: Record<string, number>;
  tickers: string[];
  skip: string[];
}

function loadConfig(only?: string[]): { cfgs: TickerCfg[]; params: Params; kc: KeeperConfig } {
  const kc: KeeperConfig = JSON.parse(readFileSync(join(ROOT, "keeper/config.mainnet.json"), "utf8"));
  const facts = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8"));
  const params = { ...DEFAULT_PARAMS, ...kc.params };
  const cfgs: TickerCfg[] = [];
  for (const t of only ?? kc.tickers) {
    const s = facts.stocks[t];
    if (!s?.bestNoHookPool) {
      log({ level: "warn", msg: "no config / no hook-free pool; run scripts/discover_pools.py", ticker: t });
      continue;
    }
    if (kc.skip.includes(t)) continue;
    cfgs.push({
      ticker: t,
      stock: s.token,
      feed: s.feed,
      feedDecimals: s.feedDecimals ?? 8,
      stockIsCurrency0: s.stockIsCurrency0,
      poolId: s.bestNoHookPool.poolId,
      fee: s.bestNoHookPool.poolKey.fee,
      tickSpacing: s.bestNoHookPool.poolKey.tickSpacing,
    });
  }
  return { cfgs, params, kc };
}

// ------------------------------------------------------------------ logging / output

const LOG_DIR = join(ROOT, "keeper/logs");
function log(o: Record<string, unknown>) {
  const line = JSON.stringify({ ts: iso(Math.floor(Date.now() / 1000)), ...o });
  console.log(line);
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(join(LOG_DIR, `paper-${isoDate(Math.floor(Date.now() / 1000))}.jsonl`), line + "\n");
  } catch {}
}

function write(outDir: string, sim: EpochSim) {
  mkdirSync(outDir, { recursive: true });
  const file = `${isoDate(sim.windowStart)}-${sim.cfg.ticker}.json`;
  writeFileSync(join(outDir, file), JSON.stringify(sim.toJSON(), null, 1));
  // index for the web app
  const entries = readdirSync(outDir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-[A-Z.]+\.json$/.test(f))
    .sort()
    .map((f) => {
      const j = JSON.parse(readFileSync(join(outDir, f), "utf8"));
      const best = j.settlement?.results?.spec?.at(-1);
      return { file: f, ticker: j.ticker, window: j.window.startIso, status: j.status, maxPremiumPct: j.stats.maxPremiumPct, vsHodlPct: best?.vsHodlPct ?? null };
    });
  writeFileSync(join(outDir, "index.json"), JSON.stringify({ updatedAt: iso(Math.floor(Date.now() / 1000)), entries }, null, 1));
}

// ------------------------------------------------------------------ epoch driver

interface Ctx {
  c: Client;
  params: Params;
  hist: Map<string, Round[]>;
}

/** When would the vault arm, and would the oracle checks pass? (SPEC §4) */
function armPlan(sim: EpochSim, hist: Round[] | undefined) {
  const p = sim.params;
  const earliest = sim.windowStart + p.armDelay;
  if (!hist) return { time: earliest, round: undefined };
  const r = roundAt(hist, earliest);
  if (!r) return { time: earliest, round: undefined, reason: "no feed round before window" };
  const time = Math.max(earliest, r.updatedAt + p.minFrozen);
  // a new round between `earliest` and `time` would reset the frozen clock; use the round live at `time`
  const r2 = roundAt(hist, time)!;
  const recentClose = r2.updatedAt >= sim.windowStart - p.maxPreCloseAge;
  const inWindow = time < sim.windowEnd;
  sim.checks = {
    feedUpdatedAt: iso(r2.updatedAt),
    frozenOk: time - r2.updatedAt >= p.minFrozen,
    recentCloseOk: recentClose,
    preCloseAgeMin: Math.round((sim.windowStart - r2.updatedAt) / 60),
    answerPositive: r2.answer > 0n,
    inWindow,
  };
  const reason = !recentClose
    ? `recent-close check fails: last feed update ${Math.round((sim.windowStart - r2.updatedAt) / 3600 * 10) / 10}h before window start (max ${p.maxPreCloseAge / 3600}h)`
    : r2.answer <= 0n
      ? "answer <= 0"
      : !inWindow
        ? "feed kept updating through the window"
        : undefined;
  return { time, round: r2, reason };
}

/** When would the vault settle? First t >= windowEnd + settleDelay with a fresh feed round (SPEC §4). */
function settlePlan(sim: EpochSim, hist: Round[] | undefined, now: number) {
  const p = sim.params;
  let t = sim.windowEnd + p.settleDelay;
  if (!hist) return t <= now ? { time: t, round: undefined } : undefined;
  const deadline = sim.windowEnd + p.emergencyDelay;
  while (t <= Math.min(now, deadline)) {
    const r = roundAt(hist, t);
    if (r && r.updatedAt >= sim.windowEnd && t - r.updatedAt <= p.maxFreshAge) return { time: t, round: r };
    const next = hist.find((x) => x.updatedAt > t);
    if (!next) return undefined;
    t = Math.max(t, next.updatedAt);
  }
  return undefined;
}

async function priceAt(ctx: Ctx, poolId: Hex, block: bigint): Promise<SwapLog | undefined> {
  return lastSwapBefore(ctx.c, poolId, block);
}

/** Advance one simulated epoch up to `now` (a past or current timestamp). Idempotent per call. */
async function advance(ctx: Ctx, sim: EpochSim, now: number, live: boolean) {
  const { c } = ctx;
  const cfg = sim.cfg;
  const hist = cfg.feed ? ctx.hist.get(cfg.ticker) : undefined;

  if (sim.status === "waiting") {
    const plan = armPlan(sim, hist);
    if (now < plan.time) return;
    if (plan.reason) {
      sim.skip(plan.reason);
      log({ ticker: cfg.ticker, event: "skip", reason: plan.reason });
      return;
    }
    if (live && cfg.feed) {
      const paused = await c.readContract({ address: cfg.stock, abi: stockAbi, functionName: "oraclePaused" });
      sim.checks.oraclePaused = paused;
      if (paused) return sim.skip("oraclePaused");
    } else {
      sim.checks.oraclePaused = live ? null : "not checked (replay: no archive state)";
    }
    sim.checks.sequencer = "no uptime feed listed for Robinhood mainnet";
    const block = await blockAtOrBefore(c, plan.time);
    const sw = await priceAt(ctx, cfg.poolId as Hex, block);
    if (!sw) return sim.skip("pool has no swaps");
    const p0 = plan.round ? plan.round.answer : (() => {
      // no Chainlink feed (e.g. HIMS): paper-only fallback to the pool price at arm
      const u = sim.usd(sw.sqrtPriceX96);
      return BigInt(Math.round(u * 10 ** sim.d.feed));
    })();
    sim.doArm({
      time: plan.time,
      block,
      p0,
      p0Source: plan.round ? "chainlink" : "pool",
      feedUpdatedAt: plan.round?.updatedAt ?? null,
      sqrtPriceX96: sw.sqrtPriceX96,
      tick: sw.tick,
    });
    log({ ticker: cfg.ticker, event: "arm", time: iso(plan.time), p0: sim.arm?.p0Usd, band: sim.arm?.bandUsd, poolUsd: sim.arm?.poolUsdAtArm });
  }
  if (sim.status !== "armed") return;

  const sp = settlePlan(sim, hist, now);
  const until = sp ? sp.time : now;
  const toBlock = await blockAtOrBefore(c, until);
  if (toBlock > sim.lastBlock) {
    const logs = await swapLogs(c, [cfg.poolId as Hex], sim.lastBlock + 1n, toBlock);
    for (const l of logs) sim.ingest(l);
    sim.lastBlock = toBlock;
  }
  if (sp) {
    const last = await priceAt(ctx, cfg.poolId as Hex, toBlock);
    const s = last!.sqrtPriceX96;
    const fresh = sp.round ? sp.round.answer : BigInt(Math.round(sim.usd(s) * 10 ** sim.d.feed));
    sim.doSettle({ time: sp.time, block: toBlock, fresh, freshSource: sp.round ? "chainlink" : "pool", freshUpdatedAt: sp.round?.updatedAt ?? null, sqrtPriceX96: s });
    log({ ticker: cfg.ticker, event: "settle", time: iso(sp.time), poolUsd: sim.settlement.poolUsd, capUsd: sim.settlement.capUsd, spec: sim.settlement.results.spec.at(-1)?.vsHodlPct });
  }
}

async function refreshHist(ctx: Ctx, cfgs: TickerCfg[], since: number) {
  for (const cfg of cfgs) {
    if (!cfg.feed) continue;
    ctx.hist.set(cfg.ticker, await feedHistory(ctx.c, cfg.feed, since));
  }
}

// ------------------------------------------------------------------ modes

async function replay(dateArg: string, only: string[] | undefined, outDir: string) {
  const { cfgs, params, kc } = loadConfig(only);
  const c = makeClient();
  const t = Math.floor(Date.parse(`${dateArg}T12:00:00Z`) / 1000);
  let ws = clockStart(t, kc.sessionOffset);
  if (t - ws >= 2 * DAY) ws += 7 * DAY; // weekday given -> next weekend
  const we = ws + 2 * DAY;
  const now = Math.floor(Date.now() / 1000);
  const ctx: Ctx = { c, params, hist: new Map() };
  log({ event: "replay", window: [iso(ws), iso(we)], tickers: cfgs.map((x) => x.ticker) });
  await refreshHist(ctx, cfgs, ws - params.maxPreCloseAge - 3 * DAY);
  for (const cfg of cfgs) {
    const sim = new EpochSim(cfg, { ...params, premiumBps: Math.max(params.premiumBps, kc.premiumTable[cfg.ticker] ?? 0) }, ws, we);
    try {
      await advance(ctx, sim, Math.min(now, we + params.emergencyDelay), false);
    } catch (e) {
      log({ level: "error", ticker: cfg.ticker, msg: String(e) });
    }
    write(outDir, sim);
  }
}

async function live(only: string[] | undefined, outDir: string) {
  const { cfgs, params, kc } = loadConfig(only);
  const c = makeClient();
  const ctx: Ctx = { c, params, hist: new Map() };
  const sims = new Map<string, EpochSim>();
  log({ event: "paper-start", tickers: cfgs.map((x) => x.ticker), outDir });
  for (;;) {
    try {
      const now = Number((await c.getBlock()).timestamp);
      const ws = clockStart(now, kc.sessionOffset);
      const we = ws + 2 * DAY;
      await refreshHist(ctx, cfgs, ws - params.maxPreCloseAge - DAY);
      for (const cfg of cfgs) {
        let sim = sims.get(cfg.ticker);
        if (!sim || sim.windowStart !== ws) {
          sim = new EpochSim(cfg, { ...params, premiumBps: Math.max(params.premiumBps, kc.premiumTable[cfg.ticker] ?? 0) }, ws, we);
          sims.set(cfg.ticker, sim);
        }
        if (sim.status === "settled" || sim.status === "skipped") continue;
        try {
          await advance(ctx, sim, now, true);
        } catch (e) {
          log({ level: "error", ticker: cfg.ticker, msg: String(e).slice(0, 400) });
        }
        if (sim.status !== "waiting") write(outDir, sim);
      }
      log({ event: "tick", now: iso(now), status: Object.fromEntries([...sims].map(([k, s]) => [k, s.status])) });
    } catch (e) {
      log({ level: "error", msg: String(e).slice(0, 400) });
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

// ------------------------------------------------------------------ cli

const args = process.argv.slice(2);
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt("--tickers")?.split(",").map((s) => s.trim().toUpperCase());
const outDir = resolve(opt("--out") ?? join(ROOT, "web/public/paper"));
const replayIdx = args.indexOf("--replay");
if (replayIdx >= 0) {
  const date = args[replayIdx + 1];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("usage: npm run replay -- YYYY-MM-DD [--tickers A,B]");
  const replayOut = resolve(opt("--out") ?? join(ROOT, "web/public/paper/replay"));
  await replay(date, only, replayOut);
} else {
  await live(only, outDir);
}
