import Link from "next/link";
import { COMMUNITY } from "@/lib/claims";
import { WEEKENDS, money, windowDates } from "@/lib/weekends";
import { GATE } from "@/lib/liveGate";

/**
 * The four features as one story (docs/FEATURES.md): see it → learn from history → act yourself → or let the vault
 * do it. Each card shows its point with a small visual from the same data files the feature pages use.
 */
const SELL_LEVELS = [10, 20, 40]; // the /sell suggested levels, in % above the reference
const SELL_TICKER = "HIMS"; // the sandbox token mirrors HIMS's history

const windows = [...WEEKENDS.windows].sort((a, b) => a.window.localeCompare(b.window));
const maxPaid = Math.max(...windows.map((w) => w.paidAboveReferenceUsd));
const since = new Date(windows[0].start).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
// What a live premium must pass before the monitor calls it verified (lib/liveGate.ts)
const CHECKS = [
  `Pool holds at least $${GATE.minTvlUsd.toLocaleString("en-US")}`,
  `A $1,000 swap moves it less than ${GATE.maxImpact1kPct}%`,
  `Traded in the last ${GATE.maxLastSwapAgeSec / 3600} hours`,
  `Robinhood's quote spread under ${GATE.maxRefSpreadPct}%`,
  `GeckoTerminal agrees within ${GATE.maxIndependentDiffPct}%`,
];
const himsRows = WEEKENDS.windows.flatMap((w) => w.tokens.filter((t) => t.ticker === SELL_TICKER && t.active && t.peakPct !== null));
const reached = (pct: number) => himsRows.filter((t) => (t.peakPct as number) >= pct).length;
const signed = (x: number) => `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;

function Card({ n, verb, title, href, cta, children, note }: { n: number; verb: string; title: string; href: string; cta: string; children: React.ReactNode; note: string }) {
  return (
    <li className="flex flex-col rounded-[12px] border border-paper-line bg-paper-card p-5">
      <div className="text-sm text-ink-faint">{`${n}. ${verb}`}</div>
      <h3 className="mt-1 text-lg font-semibold">{title}</h3>
      <div className="mt-4 flex-1">{children}</div>
      <p className="mt-3 text-[11px] text-ink-faint">{note}</p>
      <Link href={href} className="btn-ghost mt-4 self-start rounded-[6px] px-4 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">{cta}</Link>
    </li>
  );
}

export function Features() {
  const c = COMMUNITY;
  const vaultRows = [c.spike.high, c.spike.low, c.worst].filter(Boolean) as NonNullable<typeof c.worst>[];
  const vaultMax = Math.max(...vaultRows.map((x) => Math.abs(x.r.excessPctExLpFees)));
  return (
    <section id="features" className="gutter pb-16">
      <h2 className="h-section text-[40px] md:text-[56px]">Four things you can do</h2>
      <p className="mt-2 max-w-[64ch] text-ink-soft">See the premium, learn from past weekends, place your own sell order, or let the vault do it for you.</p>
      <ol className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card n={1} verb="See it" title="Monitor" href="/monitor" cta="Open the monitor"
          note="Every token's pool price against Robinhood's real share price, live. A premium counts as verified only if it passes every check above; the rest are shown with the reason.">
          <ul className="space-y-2 text-sm">
            {CHECKS.map((c) => (
              <li key={c} className="flex gap-2"><span aria-hidden className="text-tide">✓</span><span>{c}</span></li>
            ))}
          </ul>
        </Card>

        <Card n={2} verb="Learn from history" title="Weekend report" href="/weekends" cta="Read the report"
          note={`Paid above the reference on buys priced >${WEEKENDS.headlineThresholdPct}% above it, per mint-off window since ${since}. Total ${money(WEEKENDS.totals.paidAboveReferenceUsd)} by ${WEEKENDS.totals.wallets.toLocaleString("en-US")} wallets.`}>
          <div className="flex h-24 items-end gap-1" role="img" aria-label={`Bar chart: amount paid above the reference per window, largest ${money(maxPaid)}`}>
            {windows.map((w) => (
              <div key={w.window} title={`${windowDates(w)}: ${money(w.paidAboveReferenceUsd)}`}
                className={`flex-1 rounded-t-[2px] ${w.paidAboveReferenceUsd === maxPaid ? "bg-tide" : "bg-graphite/40"}`}
                style={{ height: `${Math.max(2, (w.paidAboveReferenceUsd / maxPaid) * 100)}%` }} />
            ))}
          </div>
          <div className="mt-2 text-sm"><span className="fig font-semibold">{money(maxPaid)}</span> <span className="text-ink-soft">in the weekend of {windowDates(windows.find((w) => w.paidAboveReferenceUsd === maxPaid)!)}</span></div>
        </Card>

        <Card n={3} verb="Act yourself" title="Sell order" href="/sell" cta="Place a sell order"
          note={`Your own wallet, your own Uniswap position; Offmint never holds your tokens. If it fills you hold USDG, not the stock. Testnet only.`}>
          <div className="text-sm text-ink-soft">{`Sell above the real price. How often ${SELL_TICKER} got there:`}</div>
          <ul className="mt-3 space-y-2">
            {[...SELL_LEVELS].reverse().map((p, i) => (
              <li key={p} className="flex items-center gap-3 text-sm" style={{ marginLeft: `${(SELL_LEVELS.length - 1 - i) * 16}px` }}>
                <span className="fig w-14 rounded-[6px] border border-tide px-2 py-1 text-center font-medium text-tide">{`+${p}%`}</span>
                <span className="fig">{`${reached(p)} of ${himsRows.length} windows`}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card n={4} verb="Or let the vault do it" title="Vault" href="/vault/HIMS" cta="Try the vault on testnet"
          note={`Simulated on real weekend swaps with our orders in the pool, per $${c.sizeUsd.toLocaleString("en-US")} deposited, after the ${c.feePct}% fee on profit. Can end below what you deposited. Unaudited.`}>
          <ul className="space-y-2 text-sm">
            {vaultRows.map((x) => (
              <li key={`${x.e.ticker}-${x.e.weekend}`}>
                <div className="flex justify-between"><span>{`${x.e.ticker}, ${x.e.weekend}`}</span><span className={`fig ${x.r.excessPctExLpFees >= 0 ? "text-tide" : "text-loss"}`}>{signed(x.r.excessPctExLpFees)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-paper-line">
                  <div className={`h-1.5 rounded-full ${x.r.excessPctExLpFees >= 0 ? "bg-tide" : "bg-loss"}`} style={{ width: `${Math.max(2, (Math.abs(x.r.excessPctExLpFees) / vaultMax) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">{`A normal weekend: about 0% (nothing sells, ${c.normal.count} of ${c.screened} ticker-weekends).`}</p>
        </Card>
      </ol>
    </section>
  );
}
