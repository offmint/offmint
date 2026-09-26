// Headline facts for the dark band (carousel + three-stat row). Every figure is read from a data file; the source
// line says which. No testimonials: these stand where a template would put quotes.
import frequency from "../../../public/data/frequency.json";
import mintoff from "../../../public/data/mintoff.json";
import { EVENTS } from "@/lib/claims";
import { WEEKENDS, money } from "@/lib/weekends";

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const first = [...WEEKENDS.windows].sort((a, b) => a.start.localeCompare(b.start))[0];
const since = new Date(first.start).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const eligible10 = frequency.eligible.byThreshold.find((b) => b.thresholdPct === 10)!;

export interface Fact { ticker: string | null; text: string; label: string; source: string }

export const FACTS: Fact[] = [
  ...EVENTS.map((e) => ({
    ticker: e.ticker,
    text: `${e.ticker} traded +${e.screen.maxPremiumPct!.toFixed(1)}% above its Friday reference on the weekend of ${day(e.screen.weekend)}, while no new tokens could be created.`,
    label: `${e.ticker} · weekend of ${day(e.screen.weekend)} 2026`,
    source: "Weekend screen: every swap on the deepest hook-free pool (web/public/data/screen/weekends.json)",
  })),
  {
    ticker: null,
    text: `Buyers paid ${money(WEEKENDS.totals.paidAboveReferenceUsd)} above the reference price on buys priced more than ${WEEKENDS.headlineThresholdPct}% above it, in ${WEEKENDS.totals.windows} mint-off windows since ${since}.`,
    label: `${WEEKENDS.totals.wallets.toLocaleString("en-US")} wallets · ${money(WEEKENDS.totals.buysValueUsd)} of such buys`,
    source: "Harm scan of every onchain swap vs the official close (web/public/data/weekends.json)",
  },
  {
    ticker: null,
    text: `Minting is off for ${mintoff.shareOfCalendarPct.toFixed(1)}% of the year: ${mintoff.mintOffHours.toLocaleString("en-US")} of ${mintoff.hoursInYear.toLocaleString("en-US")} hours, every weekend and US market holiday.`,
    label: `${mintoff.year} calendar`,
    source: "Robinhood Stock Token docs + NYSE holiday calendar (web/public/data/mintoff.json)",
  },
  {
    ticker: null,
    text: `A premium above 10% held for an hour or more in ${eligible10.windowsWithAnySustained} of ${frequency.eligible.windows} mint-off windows, but on only ${eligible10.sustainedSharePct}% of token-weekends. Pool-wide it recurs; per token it is rare.`,
    label: `${frequency.eligible.tickerWindows} token-weekends with at least $10,000 of depth`,
    source: "Frequency scan (web/public/data/frequency.json)",
  },
];

export const BIG_STATS = [
  { chip: "Paid above the reference", value: money(WEEKENDS.totals.paidAboveReferenceUsd), note: `On buys priced >${WEEKENDS.headlineThresholdPct}% above the reference, ${WEEKENDS.totals.windows} windows since ${since}.` },
  { chip: "Wallets", value: WEEKENDS.totals.wallets.toLocaleString("en-US"), note: `Distinct wallets that made those ${WEEKENDS.totals.buysAbove.toLocaleString("en-US")} buys.` },
  { chip: "Minting off", value: `${mintoff.shareOfCalendarPct.toFixed(1)}%`, note: `Of ${mintoff.year}: weekends plus US market holidays, ${mintoff.mintOffHours.toLocaleString("en-US")} hours.` },
];
