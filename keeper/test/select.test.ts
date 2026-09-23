import { test } from "node:test";
import assert from "node:assert/strict";
import { volumeStats, select, SELECT_DEFAULTS, type PoolVolume, type VolumeStats } from "../src/select.js";

const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
const MEME = "0x00000000000000000000000000000000000000aa";
const NOW = 1_790_000_000;
const D = 86_400;
const swaps = (from: number, to: number, n: number, each: number) =>
  Array.from({ length: n }, (_, i) => ({ ts: from + ((to - from) * (i + 0.5)) / n, stock: each }));

test("growth = last half of the 14d window vs the first half; share = top non-USDG pool", () => {
  const pools: PoolVolume[] = [
    { poolId: "0x1", quote: USDG, createdAt: NOW - 60 * D, swaps: [...swaps(NOW - 14 * D, NOW - 7 * D, 10, 10), ...swaps(NOW - 7 * D, NOW, 10, 20)] },
    { poolId: "0x2", quote: MEME, createdAt: NOW - 60 * D, swaps: swaps(NOW - 7 * D, NOW, 10, 10) },
  ];
  const s = volumeStats("GLXY", "0xg", pools, NOW);
  assert.equal(s.windowDays, 14);
  assert.equal(s.volPrior, 100);
  assert.equal(s.volRecent, 300);
  assert.equal(s.growthPct, 200);
  assert.equal(s.topNonUsdgQuote, MEME);
  assert.equal(s.topNonUsdgSharePct, 25); // 100 of 400
});

test("young pool: growth over the history that exists; < 2 days -> growth 0", () => {
  const young: PoolVolume[] = [{ poolId: "0x1", quote: USDG, createdAt: NOW - 4 * D, swaps: [...swaps(NOW - 4 * D, NOW - 2 * D, 5, 10), ...swaps(NOW - 2 * D, NOW, 5, 30)] }];
  const s = volumeStats("NEW", "0xn", young, NOW);
  assert.equal(s.windowDays, 4);
  assert.equal(s.growthPct, 200);
  const baby: PoolVolume[] = [{ poolId: "0x1", quote: USDG, createdAt: NOW - D, swaps: swaps(NOW - D, NOW, 5, 10) }];
  assert.equal(volumeStats("BABY", "0xb", baby, NOW).growthPct, 0);
  assert.equal(volumeStats("NONE", "0xz", [], NOW).growthPct, 0);
});

const st = (ticker: string, growthPct: number, share: number): VolumeStats => ({
  ticker, token: `0x${ticker}`, windowDays: 14, volRecent: 0, volPrior: 0, growthPct, topNonUsdgQuote: null, topNonUsdgSharePct: share,
});

test("zero picks is normal: nothing clears the bar", () => {
  const r = select([st("A", 10, 5), st("B", -20, 30)], SELECT_DEFAULTS);
  assert.equal(r.picks.length, 0);
  assert.match(r.scored[0].reason, /below bar/);
});

test("picks at most maxConcurrent, best score first; skip and blacklist are never picked", () => {
  const stats = [st("A", 150, 10), st("B", 300, 40), st("C", 90, 60), st("D", 500, 0), st("E", 400, 0)];
  const r = select(stats, SELECT_DEFAULTS, { skip: ["d"], blacklisted: ["0xE"] });
  assert.deepEqual(r.picks.map((p) => p.ticker), ["B", "A"]);
  assert.equal(r.scored.find((s) => s.ticker === "D")!.reason, "skip / earnings list");
  assert.match(r.scored.find((s) => s.ticker === "E")!.reason, /blacklisted/);
  assert.equal(select(stats, { ...SELECT_DEFAULTS, maxConcurrent: 3 }).picks.length, 3);
  assert.equal(select(stats, { ...SELECT_DEFAULTS, w1: 0 }).picks.length, 0, "weights are tunable");
});
