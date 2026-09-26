// Weekend report data (docs/FEATURES.md Feature 2): one row per mint-off window since 1 Jul, with per-token detail.
//   npm run weekends -w backtest      (after `npm run harm` and `npm run supply`)
// Same pools, reference closes and buy rules as harm.json (via tickerWindows.ts); the community-vault column comes from the
// with-supply replay (simulated). Writes web/public/data/weekends.json.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Hex } from "viem";
import { makeClient, blockTime, blockAtOrBefore, swapLogs } from "../../keeper/src/chain.js";
import { mintOffWindows } from "./window.js";
import { tickerWindows, loadPools, loadCloses, loadWindowLogs, usdOf, CACHE, type TickerWindow } from "./tickerWindows.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const since = "2026-07-01";
const HEADLINE = 5; // % above reference (docs/DECISIONS.md D6)
const DETAIL = 2;
const RECOVERY_PCT = 5;
const RECOVERY_MAX_H = 72;
const VAULT_SIZES = ["1000", "10000"];

const c = makeClient();
const head = Number((await c.getBlock()).timestamp);
const latest = await c.getBlockNumber();
const windows = mintOffWindows(Date.parse(`${since}T00:00:00Z`) / 1000, head);
const pools = loadPools();
const closes = loadCloses(since);
const timeOf = (b: number) => blockTime(c, BigInt(b), latest);
const txFrom: Record<string, string> = existsSync(join(CACHE, "txfrom.json")) ? JSON.parse(readFileSync(join(CACHE, "txfrom.json"), "utf8")) : {};
const replayPath = join(ROOT, "web/public/data/supply/replay.json");
const replay = existsSync(replayPath) ? JSON.parse(readFileSync(replayPath, "utf8")) : null;
const screen = JSON.parse(readFileSync(join(ROOT, "web/public/data/screen/weekends.json"), "utf8"));

const wallets = (txs: string[]) => new Set(txs.map((h) => txFrom[h]).filter(Boolean)).size;
const r2 = (x: number) => Math.round(x * 100) / 100;
const dateOf = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);

/** Hours after the window until the main pool trades within 5% of the first post-window close (null if not within 72 h). */
async function recoveryHours(w: { end: number }, r: TickerWindow): Promise<{ hours: number | null; postReference: number | null; postRefDate: string | null }> {
  const cl = closes[r.ticker] ?? {};
  const postRefDate = Object.keys(cl).sort().find((d) => d >= dateOf(w.end)) ?? null;
  const postRef = postRefDate ? cl[postRefDate] : null;
  if (!postRef) return { hours: null, postReference: null, postRefDate };
  const within = (sq: bigint) => Math.abs(usdOf(sq, r.stockIs0) / postRef - 1) * 100 <= RECOVERY_PCT;
  if (r.lastPrice && within(r.lastPrice.sqrtPriceX96)) return { hours: 0, postReference: postRef, postRefDate };
  const [b0, b1] = [await blockAtOrBefore(c, w.end), await blockAtOrBefore(c, Math.min(head, w.end + RECOVERY_MAX_H * 3600))];
  for (const l of await swapLogs(c, [r.mainPool as Hex], b0 + 1n, b1)) {
    if (l.liquidity > 0n && within(l.sqrtPriceX96)) return { hours: Math.round(((l.ts - w.end) / 3600) * 10) / 10, postReference: postRef, postRefDate };
  }
  return { hours: null, postReference: postRef, postRefDate };
}

/** Community vault, with-supply replay (simulated), for this ticker's weekend inside the window. */
function vaultOf(ticker: string, w: { start: number; end: number }) {
  const inScreen = !!screen.tickers[ticker];
  const ev = replay?.events.find((e: any) => e.ticker === ticker && Date.parse(`${e.weekend}T00:00:00Z`) / 1000 >= w.start - 86_400 && Date.parse(`${e.weekend}T00:00:00Z`) / 1000 < w.end);
  if (ev) return {
    label: "simulated", replayedWeekend: ev.weekend,
    bySize: Object.fromEntries(VAULT_SIZES.map((s) => [s, { excessPct: ev.bySize[s].supply?.excessPct ?? null, excessPctExLpFees: ev.bySize[s].supply?.excessPctExLpFees ?? null, state: ev.bySize[s].supply?.state ?? null }])),
  };
  if (inScreen) return { label: "simulated", note: `logged peak below the +${replay?.minPremiumReplayedPct ?? 5}% replay threshold: the ladder starts at +8%, so no fills (gas only)` };
  return { label: null, note: "not in the replayed universe" };
}

const out: any[] = [];
for (const w of windows) {
  const rows = await tickerWindows(w, loadWindowLogs(w), pools, closes, timeOf);
  const active = rows.filter((r) => r.active);
  const txs = (th: number) => rows.flatMap((r) => r.buys[th].txs);
  const tokens = [];
  for (const r of rows) {
    if (!(r.active || r.buys[DETAIL].swaps > 0)) continue;
    const rec = r.active && r.peakPct >= 10 ? await recoveryHours(w, r) : null;
    tokens.push({
      ticker: r.ticker, reference: r.reference, refDate: r.refDate, active: r.active, mainPoolSwaps: r.mainPoolSwaps,
      peakPct: r.active ? r.peakPct : null, hoursAbove10: r.active ? r.hoursAbove[10] : null,
      paidAboveReferenceUsd: r2(r.buys[HEADLINE].usdAbove), buysAbove: r.buys[HEADLINE].swaps, wallets: wallets(r.buys[HEADLINE].txs),
      detail2pct: { paidAboveReferenceUsd: r2(r.buys[DETAIL].usdAbove), buys: r.buys[DETAIL].swaps, wallets: wallets(r.buys[DETAIL].txs) },
      recovery: rec, vault: vaultOf(r.ticker, w),
    });
  }
  const biggest = active.sort((a, b) => b.peakPct - a.peakPct)[0];
  out.push({
    window: w.label, start: new Date(w.start * 1000).toISOString(), end: new Date(w.end * 1000).toISOString(), hours: (w.end - w.start) / 3600,
    reason: w.reason, refDate: w.refDate, source: "observed onchain",
    sample: { tickersWithTrackingPool: rows.length, activeTickers: active.length, swaps: rows.reduce((a, r) => a + r.mainPoolSwaps, 0) },
    tokensAbove10: active.filter((r) => r.hoursAbove[10] >= 1).length,
    biggest: biggest ? { ticker: biggest.ticker, peakPct: biggest.peakPct } : null,
    paidAboveReferenceUsd: r2(rows.reduce((a, r) => a + r.buys[HEADLINE].usdAbove, 0)),
    wallets: wallets(txs(HEADLINE)),
    buysAbove: rows.reduce((a, r) => a + r.buys[HEADLINE].swaps, 0),
    detail2pct: { paidAboveReferenceUsd: r2(rows.reduce((a, r) => a + r.buys[DETAIL].usdAbove, 0)), wallets: wallets(txs(DETAIL)), buys: rows.reduce((a, r) => a + r.buys[DETAIL].swaps, 0) },
    tokens,
  });
  console.error(`${w.label}: ${active.length} active tokens, ${out.at(-1).tokensAbove10} above 10% for 1h+, $${Math.round(out.at(-1).paidAboveReferenceUsd)} paid >${HEADLINE}% above reference by ${out.at(-1).wallets} wallets`);
}
const harm = JSON.parse(readFileSync(join(ROOT, "web/public/data/harm.json"), "utf8"));
const doc = {
  generatedAt: new Date().toISOString(),
  label: "observed onchain (Robinhood Chain mainnet); vault column simulated",
  headlineThresholdPct: HEADLINE,
  method: [
    ...harm.method,
    `Tokens above 10% = the token's most active tracking pool traded at least 10% above the reference for 1 hour or more in total (tokens with fewer than 10 swaps in the window are not counted). Peak = the highest premium the pool held for at least 15 minutes (a single stray print into a near-empty price range is not a price anyone traded at).`,
    `Recovery = hours after the window until that pool traded within ${RECOVERY_PCT}% of the first post-window close (null = not within ${RECOVERY_MAX_H} h).`,
    "Vault = the community vault's default ladder in the with-supply replay (web/public/data/supply/replay.json), simulated, per $1,000 and $10,000 of tokens deposited.",
  ],
  excluded: harm.excluded,
  windows: out.reverse(),
};
writeFileSync(join(ROOT, "web/public/data/weekends.json"), JSON.stringify(doc, null, 1));
console.log(`wrote web/public/data/weekends.json (${out.length} windows)`);
