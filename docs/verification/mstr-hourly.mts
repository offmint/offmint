// MSTR weekend of 29 Aug: highest print vs traded level. Hour by hour over the mint-off window (Sat 00:00 to Mon 00:00
// UTC): swaps, median and max pool price vs the Chainlink close, and swaps above +150% / +200%. Read-only mainnet logs.
// Run: cd keeper && npx tsx ../docs/verification/mstr-hourly.mts
import { makeClient, blockAtOrBefore, swapLogs, feedHistory } from "../../keeper/src/chain.js";
const c = makeClient();
const POOL = "0x319bac87e616a89e241c10aeb8afd4892a852cdd8b373cd9765ecddc40b87cfe" as const;
const FEED = "0x396118bdFB181e6240E74D243F266B061c0edc3D" as const;
const usd = (sq: bigint) => { const s = Number(sq) / 2 ** 96; return 1e12 / (s * s); }; // stock = currency1
const H = 3600, SAT = Date.UTC(2026, 7, 29) / 1000;
const rounds = await feedHistory(c, FEED, SAT - 3 * 86400);
const ref = Number(rounds.filter((r) => r.updatedAt <= SAT).at(-1)!.answer) / 1e8;
console.log(`reference (last Chainlink round before Sat 00:00) $${ref.toFixed(2)}`);
let maxP = 0, maxAt = "", n = 0, over150 = 0, over200 = 0, hoursMedOver150 = 0;
for (let h = 0; h < 48; h++) {
  const [a, b] = [await blockAtOrBefore(c, SAT + h * H), await blockAtOrBefore(c, SAT + (h + 1) * H)];
  const logs = (await swapLogs(c, [POOL], a, b - 1n)).filter((l) => l.liquidity > 0n);
  const prem = logs.map((l) => (usd(l.sqrtPriceX96) / ref - 1) * 100).sort((x, y) => x - y);
  if (!prem.length) { console.log(`h${String(h).padStart(2)} no swaps`); continue; }
  const med = prem[Math.floor(prem.length / 2)], mx = prem.at(-1)!;
  n += prem.length; over150 += prem.filter((p) => p > 150).length; over200 += prem.filter((p) => p > 200).length;
  if (med > 150) hoursMedOver150++;
  if (mx > maxP) { maxP = mx; maxAt = new Date((SAT + h * H) * 1000).toISOString().slice(5, 16); }
  console.log(`h${String(h).padStart(2)} ${new Date((SAT + h * H) * 1000).toISOString().slice(5, 16)} swaps=${String(prem.length).padStart(5)} median=${med.toFixed(1)}% max=${mx.toFixed(1)}% >200%=${prem.filter((p) => p > 200).length}`);
}
console.log(`TOTAL swaps=${n} max=${maxP.toFixed(2)}% (hour starting ${maxAt}) swaps>150%=${over150} swaps>200%=${over200} hours with median>150%=${hoursMedOver150}`);
