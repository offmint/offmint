import { makeClient, blockAtOrBefore, swapLogs, feedHistory } from "/home/dev/offmint/keeper/src/chain.js";
const c = makeClient();
const POOL = "0x319bac87e616a89e241c10aeb8afd4892a852cdd8b373cd9765ecddc40b87cfe" as const;
const FEED = "0x396118bdFB181e6240E74D243F266B061c0edc3D" as const;
const usd = (sq: bigint) => { const s = Number(sq) / 2 ** 96; return 1e12 / (s * s); }; // stock = currency1
const H = 3600, SAT = Date.UTC(2026, 7, 29) / 1000;
const rounds = await feedHistory(c, FEED, SAT - 3 * 86400);
const at = (t: number) => rounds.filter((r) => r.updatedAt <= t).at(-1);
for (const [label, t0] of [["Thu 16:00", SAT - 32 * H], ["Fri 18:00", SAT - 6 * H], ["Sat 00:00", SAT], ["Sat 12:00", SAT + 12 * H], ["Sun 12:00", SAT + 36 * H], ["Mon 00:00", SAT + 48 * H], ["Mon 16:00", SAT + 64 * H], ["Tue 16:00", SAT + 88 * H]] as [string, number][]) {
  const [a, b] = [await blockAtOrBefore(c, t0), await blockAtOrBefore(c, t0 + 1800)];
  const logs = (await swapLogs(c, [POOL], a, b)).filter((l) => l.liquidity > 0n);
  const px = logs.map((l) => usd(l.sqrtPriceX96));
  const r = at(t0 + 1800);
  const cl = r ? Number(r.answer) / 1e8 : NaN;
  const med = px.sort((x, y) => x - y)[Math.floor(px.length / 2)];
  console.log(`${label.padEnd(10)} swaps=${String(logs.length).padStart(5)} poolMedian=$${med?.toFixed(2)} chainlink=$${cl.toFixed(2)} (updated ${r ? new Date(r.updatedAt * 1000).toISOString().slice(5, 16) : "-"}) premium=${med ? ((med / cl - 1) * 100).toFixed(1) : "-"}%`);
}
