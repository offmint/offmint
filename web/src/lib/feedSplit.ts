// Feed vs no-feed spike counts for the landing, README and submission copy (server-only: weekends.json is ~290 KB, so
// this lives outside lib/claims.ts, which client components import). Checked by web/test/claims.test.ts.
import weekendReport from "../../public/data/weekends.json";
import feedList from "../../public/data/feeds.json";
import { maxOver } from "./claims";

/**
 * Feed vs no feed, from the weekend report (every hook-free pool, 12 windows, premium held 15 min vs the official close).
 * A spike = held more than 10% above the reference for an hour or more. A Chainlink feed does not make a token immune.
 */
export const FEED_SPLIT = (() => {
  const feed = new Set((feedList as any).tickers as string[]);
  const wins = (weekendReport as any).windows as { window: string; tokens?: { ticker: string; peakPct: number | null; hoursAbove10: number }[] }[];
  const spikes = wins.flatMap((w) => (w.tokens ?? []).filter((r) => (r.peakPct ?? 0) >= 10 && r.hoursAbove10 >= 1).map((r) => ({ ...r, window: w.window, hasFeed: feed.has(r.ticker) })));
  const withFeed = spikes.filter((s) => s.hasFeed);
  const LARGE = ["NVDA", "TSLA", "AAPL", "SPY"];
  const large = wins.flatMap((w) => (w.tokens ?? []).filter((r) => LARGE.includes(r.ticker)).map((r) => r.peakPct ?? -Infinity));
  const lmt = spikes.filter((s) => s.ticker === "LMT").sort((a, b) => b.peakPct! - a.peakPct!)[0];
  return {
    windows: wins.length, first: wins.map((w) => w.window).sort()[0], last: wins.map((w) => w.window).sort().at(-1)!,
    spikes: spikes.length, noFeed: spikes.length - withFeed.length, withFeed: withFeed.length,
    withFeedTickers: [...new Set(withFeed.map((s) => s.ticker))].sort(),
    // the largest names' highest held premium: the weekend report and the screen use different peaks, take the larger
    largeMaxPct: Math.max(Math.max(...large), maxOver(LARGE)),
    lmt: lmt ? { pct: lmt.peakPct!, window: lmt.window, hours: lmt.hoursAbove10 } : null,
    feedCount: feed.size,
  };
})();
