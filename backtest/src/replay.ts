// Backtest (SPEC §10): replay a past weekend against real v4 Swap logs with the keeper's EpochSim.
//   npm run replay -w backtest -- --event hims-2026-08-28
// Writes web/public/data/backtest/<event>.json (timeline, band, fills, per-quantity results for every variant).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { makeClient, blockAtOrBefore, swapLogs, lastSwapBefore } from "../../keeper/src/chain.js";
import { EpochSim, DEFAULT_PARAMS, type TickerCfg } from "../../keeper/src/engine.js";
import { summarize, type EventCfg } from "./summary.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--event");
  const id = i >= 0 ? args[i + 1] : undefined;
  const events: Record<string, EventCfg> = JSON.parse(readFileSync(join(ROOT, "backtest/events.json"), "utf8"));
  if (!id || !events[id]) throw new Error(`usage: --event <${Object.keys(events).join("|")}>`);
  const ev = events[id];
  const facts = JSON.parse(readFileSync(join(ROOT, "contracts/config/mainnet.json"), "utf8"));
  let s = facts.stocks[ev.ticker];
  if (!s?.bestNoHookPool) {
    const basket = JSON.parse(readFileSync(join(ROOT, "contracts/config/basket.json"), "utf8"));
    const m = [...basket.members, ...basket.excluded].find((x: any) => x.ticker === ev.ticker && x.pool);
    if (m) s = { token: m.token, feed: null, stockIsCurrency0: m.pool.stockIsCurrency0, bestNoHookPool: { poolId: m.pool.poolId, poolKey: m.pool.poolKey } };
  }
  if (!s?.bestNoHookPool) throw new Error(`${ev.ticker} missing from contracts/config/mainnet.json`);
  const cfg: TickerCfg = {
    ticker: ev.ticker,
    stock: s.token,
    feed: s.feed,
    feedDecimals: s.feedDecimals ?? 8,
    stockIsCurrency0: s.stockIsCurrency0,
    poolId: s.bestNoHookPool.poolId,
    fee: s.bestNoHookPool.poolKey.fee,
    tickSpacing: s.bestNoHookPool.poolKey.tickSpacing,
  };
  const params = { ...DEFAULT_PARAMS, ...(ev.params ?? {}) };
  const ws = Math.floor(Date.parse(ev.windowStart) / 1000);
  const we = ws + 2 * 86400;
  const c = makeClient();
  const sim = new EpochSim(cfg, params, ws, we);

  const armTime = ws + params.armDelay;
  const armBlock = await blockAtOrBefore(c, armTime);
  const atArm = await lastSwapBefore(c, cfg.poolId as Hex, armBlock);
  if (!atArm) throw new Error("no swaps before arm");
  let p0Usd = ev.p0 ? Number(ev.p0) : NaN;
  if (!ev.p0) {
    // no NYSE/feed reference given: pool price at Friday 20:00 UTC (market close)
    const fri = await lastSwapBefore(c, cfg.poolId as Hex, await blockAtOrBefore(c, ws - 4 * 3600));
    p0Usd = Number((await import("../../keeper/src/rangeMath.js")).sqrtPriceX96ToUsd(fri!.sqrtPriceX96, { feed: 8, stock: 18, usd: 6 }, cfg.stockIsCurrency0)) / 1e8;
  }
  const p0 = BigInt(Math.round(p0Usd * 10 ** cfg.feedDecimals));
  sim.doArm({ time: armTime, block: armBlock, p0, p0Source: "chainlink", feedUpdatedAt: null, sqrtPriceX96: atArm.sqrtPriceX96, tick: atArm.tick });
  if (sim.status !== "armed") throw new Error(`not armed: ${sim.skipReason}`);

  const settleTime = we + params.settleDelay;
  const settleBlock = await blockAtOrBefore(c, settleTime);
  const logs = await swapLogs(c, [cfg.poolId as Hex], armBlock + 1n, settleBlock);
  for (const l of logs) sim.ingest(l);
  const last = logs.at(-1) ?? atArm;
  const fresh = BigInt(Math.round(sim.usd(last.sqrtPriceX96) * 10 ** cfg.feedDecimals));
  sim.doSettle({ time: settleTime, block: settleBlock, fresh, freshSource: "pool", freshUpdatedAt: null, sqrtPriceX96: last.sqrtPriceX96 });

  const out = { id, event: ev, ...summarize(sim.toJSON(), ev) };
  const dir = join(ROOT, "web/public/data/backtest");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out.summary, null, 2));
  console.log(`wrote web/public/data/backtest/${id}.json (${logs.length} swaps)`);
}

await main();
