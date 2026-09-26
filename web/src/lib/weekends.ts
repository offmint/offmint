// Weekend report data (docs/FEATURES.md Feature 2), read only from web/public/data/weekends.json
// (backtest/src/weekends.ts). Checked against harm.json by web/test/claims.test.ts.
import doc from "../../public/data/weekends.json";

export interface WeekendToken {
  ticker: string;
  reference: number;
  refDate: string;
  active: boolean;
  mainPoolSwaps: number;
  peakPct: number | null;
  hoursAbove10: number | null;
  buysValueUsd: number; // total value of the buys priced > headline % above the reference
  paidAboveReferenceUsd: number; // on those buys: amount paid above the reference (buysValue - stock x reference)
  buysAbove: number;
  wallets: number;
  detail2pct: { buysValueUsd: number; paidAboveReferenceUsd: number; buys: number; wallets: number };
  recovery: { hours: number | null; postReference: number | null; postRefDate: string | null } | null;
  paper: { status: string; p0Usd: number | null; maxPremiumPct: number | null; vsHodlPctExFees: number | null; state: string | null } | null;
  vault: { label: string | null; replayedWeekend?: string; note?: string; bySize?: Record<string, { excessPct: number | null; excessPctExLpFees: number | null; state: string | null }> };
}
export interface WeekendWindow {
  window: string;
  start: string;
  end: string;
  hours: number;
  reason: string;
  refDate: string;
  source: string;
  sample: { tickersWithTrackingPool: number; activeTickers: number; swaps: number };
  tokensAbove10: number;
  biggest: { ticker: string; peakPct: number } | null;
  buysValueUsd: number;
  paidAboveReferenceUsd: number;
  wallets: number;
  buysAbove: number;
  detail2pct: { buysValueUsd: number; paidAboveReferenceUsd: number; wallets: number; buys: number };
  paper: { label: string; tokens: number; settled: number; complete: boolean; filled: number } | null;
  tokens: WeekendToken[];
}

export const WEEKENDS = doc as unknown as {
  generatedAt: string;
  label: string;
  headlineThresholdPct: number;
  method: string[];
  excluded: { tickersWithoutReference: string[]; hookedPoolsNotScanned: number; offReferencePoolWindows: number; offReferenceSwaps: number };
  totals: { windows: number; buysAbove: number; buysValueUsd: number; paidAboveReferenceUsd: number; wallets: number };
  windows: WeekendWindow[];
};

export const windowOf = (date: string) => WEEKENDS.windows.find((w) => w.window === date);

/** "Sat 29 – Mon 31 Aug" style label from the window's start/end (end is exclusive). */
export function windowDates(w: Pick<WeekendWindow, "start" | "end">): string {
  const f = (d: Date, month: boolean) => d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", ...(month ? { month: "short" } : {}), timeZone: "UTC" });
  const s = new Date(w.start);
  const e = new Date(Date.parse(w.end) - 1000);
  return `${f(s, s.getUTCMonth() !== e.getUTCMonth())} – ${f(e, true)}`;
}
export const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
