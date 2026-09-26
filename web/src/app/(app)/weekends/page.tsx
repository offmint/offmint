import Link from "next/link";
import { Token } from "@/components/TokenLogo";
import { WEEKENDS, windowDates, money } from "@/lib/weekends";
import { Footnotes } from "@/components/WeekendFootnotes";
import { MintOffWindow } from "@/components/MintOffWindow";

export const metadata = { title: "Weekend report · Offmint" };

/** Feature 2: one row per mint-off window (weekend or US holiday), newest first. Numbers only from weekends.json. */
export default function Weekends() {
  const th = WEEKENDS.headlineThresholdPct;
  const T = WEEKENDS.totals;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekend report</h1>
        <p className="mt-2 max-w-[75ch] text-sm text-ink-soft">
          Every window since 1 July when new stock tokens could not be minted (weekends and US market holidays), measured on
          the real Uniswap v4 swaps on Robinhood Chain. We count buys priced more than {th}% above the last official close
          (the reference) and report two different numbers: the <b>value of those buys</b>, and the <b>amount paid above the
          reference</b> on them (what they paid minus the same tokens at the reference price). Neither is a loss: the price
          includes the pool fee, and a buyer whose stock opened higher afterwards may have lost nothing.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="card"><div className="label">Windows since 1 Jul</div><div className="num text-xl">{T.windows}</div></div>
        <div className="card"><div className="label">{`Value of buys priced >${th}% above the reference`}</div><div className="num text-xl">{money(T.buysValueUsd)}</div><div className="text-xs text-ink-faint">{`${T.buysAbove.toLocaleString("en-US")} buys`}</div></div>
        <div className="card"><div className="label">Paid above the reference on those buys</div><div className="num text-xl">{money(T.paidAboveReferenceUsd)}</div></div>
        <div className="card"><div className="label">Wallets that made them</div><div className="num text-xl">{T.wallets.toLocaleString("en-US")}</div><div className="text-xs text-ink-faint">bots and aggregators included</div></div>
      </div>
      <div className="overflow-x-auto">
        <table className="data min-w-[820px]">
          <thead>
            <tr>
              <th>Window</th>
              <th>Tokens above 10%</th>
              <th>Biggest premium (held 15 min)</th>
              <th>{`Value of buys >${th}% above`}</th>
              <th>Paid above the reference</th>
              <th>Wallets</th>
              <th>Sample</th>
            </tr>
          </thead>
          <tbody>
            {WEEKENDS.windows.map((w) => (
              <tr key={w.window}>
                <td>
                  <Link href={`/weekends/${w.window}`} className="font-medium text-tide hover:underline">{windowDates(w)}</Link>
                  {w.reason !== "weekend" && <div className="text-xs text-ink-faint">{w.reason}</div>}
                  {w.paper && <div className="text-xs text-tide">{`paper mode: ${w.paper.settled} of ${w.paper.tokens} tokens settled (live)`}</div>}
                </td>
                <td className="num">{w.tokensAbove10}</td>
                <td>{w.biggest ? <span className="flex items-center gap-2"><Token ticker={w.biggest.ticker} size={18} /><span className="num">{`${w.biggest.peakPct >= 0 ? "+" : ""}${w.biggest.peakPct.toFixed(1)}%`}</span></span> : "–"}</td>
                <td className="num">{money(w.buysValueUsd)}</td>
                <td className="num">{money(w.paidAboveReferenceUsd)}</td>
                <td className="num">{w.wallets.toLocaleString("en-US")}</td>
                <td className="text-xs text-ink-faint">{`${w.sample.activeTickers} tokens, ${w.sample.swaps.toLocaleString("en-US")} swaps`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footnotes />
      <div className="border-t border-paper-line pt-6"><MintOffWindow /></div>
    </div>
  );
}
