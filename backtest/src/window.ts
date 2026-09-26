// Mint-off windows (docs/TAILOR.md Phase 1 item 5, docs/AIRTIGHT.md item 3).
//   npm run window -w backtest [-- --year 2026]   -> web/public/data/mintoff.json
// Robinhood's tokenization window (support article "About Stock Tokens"): Monday 02:00 until Saturday 02:00 CET/CEST,
// closed on US market holidays; outside it minting/burning is off but tokens still trade onchain (Robinhood Chain docs).
// So minting is off Sat 02:00 -> Mon 02:00 Europe/Berlin time (48 h), plus each US market holiday. We model a holiday as
// 02:00 on the holiday -> 02:00 the next day (Berlin), merged with an adjacent weekend. That is our reading, stated as such.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DAY = 86_400;

/** NYSE full-day closures (nyse.com/markets/hours-calendars). Early closes are not mint-off days. */
export const US_HOLIDAYS: Record<string, string> = {
  "2026-01-01": "New Year's Day", "2026-01-19": "Martin Luther King Jr. Day", "2026-02-16": "Washington's Birthday",
  "2026-04-03": "Good Friday", "2026-05-25": "Memorial Day", "2026-06-19": "Juneteenth", "2026-07-03": "Independence Day (observed)",
  "2026-09-07": "Labor Day", "2026-11-26": "Thanksgiving Day", "2026-12-25": "Christmas Day",
};

/** Berlin UTC offset (hours) at a UTC timestamp: CEST (+2) between the last Sundays of March and October, 01:00 UTC. */
export function berlinOffset(ts: number): number {
  const y = new Date(ts * 1000).getUTCFullYear();
  const lastSun = (m: number) => { const d = new Date(Date.UTC(y, m + 1, 0)); return Date.UTC(y, m, d.getUTCDate() - d.getUTCDay(), 1) / 1000; };
  return ts >= lastSun(2) && ts < lastSun(9) ? 2 : 1;
}
/** UTC timestamp of 02:00 Berlin time on the given UTC calendar date. */
const at0200Berlin = (dateTs: number) => dateTs + (2 - berlinOffset(dateTs)) * 3600;
const iso = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
const dow = (ts: number) => new Date(ts * 1000).getUTCDay(); // 0 Sun .. 6 Sat

export interface Window { label: string; start: number; end: number; refDate: string; reason: string }

/** Every mint-off window that starts on/after `from` and has ended by `to`, weekends merged with adjacent holidays. */
export function mintOffWindows(from: number, to: number): Window[] {
  const offDays: number[] = []; // UTC midnights of calendar days whose 02:00-02:00 Berlin block is mint-off
  for (let d = from - (from % DAY); d < to + DAY; d += DAY) if (dow(d) === 6 || dow(d) === 0 || US_HOLIDAYS[iso(d)]) offDays.push(d);
  const out: Window[] = [];
  for (let i = 0; i < offDays.length; ) {
    let j = i;
    while (j + 1 < offDays.length && offDays[j + 1] === offDays[j] + DAY) j++;
    const start = at0200Berlin(offDays[i]);
    const end = at0200Berlin(offDays[j] + DAY);
    // reference = last US session before the window: step back over weekends and holidays
    let r = offDays[i] - DAY;
    while (dow(r) === 0 || dow(r) === 6 || US_HOLIDAYS[iso(r)]) r -= DAY;
    const hol = offDays.slice(i, j + 1).map(iso).filter((x) => US_HOLIDAYS[x]);
    if (start >= from && end <= to) {
      out.push({ label: iso(offDays[i]), start, end, refDate: iso(r), reason: [...(offDays.slice(i, j + 1).some((d) => dow(d) === 6) ? ["weekend"] : []), ...hol.map((h) => US_HOLIDAYS[h])].join(" + ") });
    }
    i = j + 1;
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const year = Number(args.includes("--year") ? args[args.indexOf("--year") + 1] : 2026);
  const from = Date.UTC(year, 0, 1) / 1000, to = Date.UTC(year + 1, 0, 1) / 1000;
  // clip windows at the year edges so hours sum to exactly the time inside the year
  const ws = mintOffWindows(from - 7 * DAY, to + 7 * DAY)
    .map((w) => ({ ...w, start: Math.max(w.start, from), end: Math.min(w.end, to) }))
    .filter((w) => w.end > w.start);
  const hours = ws.reduce((a, w) => a + (w.end - w.start) / 3600, 0);
  const weekendOnly = ws.filter((w) => w.reason === "weekend");
  const yearHours = (to - from) / 3600;
  const withSat = ws.filter((w) => { for (let d = w.start - (w.start % DAY); d < w.end; d += DAY) if (dow(d) === 6) return true; return false; });
  const holidayHours = hours - 48 * withSat.length;
  const out = {
    generatedAt: new Date().toISOString(),
    label: "computed from Robinhood's published tokenization window + the NYSE holiday calendar",
    sources: [
      { what: "Minting and burning are not supported outside the tokenization window; Stock Tokens still trade onchain", url: "https://docs.robinhood.com/chain/stock-tokens/" },
      { what: "Tokenization window: Monday 02:00 until Saturday 02:00 CET/CEST, closed on US market holidays", url: "https://robinhood.com/eu/en/support/articles/about-stock-tokens/" },
      { what: "US market holidays", url: "https://www.nyse.com/markets/hours-calendars" },
    ],
    assumption: "A US holiday is mint-off from 02:00 Berlin on the holiday to 02:00 the next day, merged with an adjacent weekend.",
    year,
    hoursInYear: yearHours,
    mintOffHours: Math.round(hours * 100) / 100,
    shareOfCalendarPct: Math.round((hours / yearHours) * 10_000) / 100,
    arithmetic: {
      weekends: withSat.length,
      weekendHours: 48,
      holidays: Object.keys(US_HOLIDAYS).filter((d) => d.startsWith(String(year))).length,
      holidayHours: Math.round(holidayHours * 100) / 100,
      text: `${withSat.length} weekends x 48 h + ${Math.round(holidayHours)} h of US holidays = ${Math.round(hours)} h of ${yearHours} h in ${year} = ${Math.round((hours / yearHours) * 1000) / 10}% of the calendar`,
    },
    longestWindowHours: Math.max(...ws.map((w) => (w.end - w.start) / 3600)),
    windowsWithHolidays: ws.filter((w) => w.reason !== "weekend").map((w) => ({ start: new Date(w.start * 1000).toISOString(), end: new Date(w.end * 1000).toISOString(), hours: (w.end - w.start) / 3600, reason: w.reason })),
    plainWeekends: weekendOnly.length,
  };
  const p = join(ROOT, "web/public/data/mintoff.json");
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(out, null, 1));
  console.log(out.arithmetic.text);
  console.log(`wrote ${p}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
