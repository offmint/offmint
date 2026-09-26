import Link from "next/link";
import { Token } from "@/components/TokenLogo";
import { WEEKENDS, windowDates, money } from "@/lib/weekends";
import { Footnotes } from "@/components/WeekendFootnotes";

export const metadata = { title: "Weekend report · Offmint" };

/** Feature 2: one row per mint-off window (weekend or US holiday), newest first. Numbers only from weekends.json. */
export default function Weekends() {
  const th = WEEKENDS.headlineThresholdPct;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Weekend report</h1>
        <p className="mt-2 max-w-[70ch] text-sm text-ink-soft">
          Every window since 1 July when new stock tokens could not be minted (weekends and US market holidays), measured on
          the real Uniswap v4 swaps on Robinhood Chain. &quot;Paid above the reference&quot; is what buyers paid over the
          last official close, counting only buys more than {th}% above it. It is not a loss: it includes the pool fee, and
          a buyer whose stock opened higher afterwards may have lost nothing.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="data min-w-[720px]">
          <thead>
            <tr>
              <th>Window</th>
              <th>Tokens above 10%</th>
              <th>Biggest premium (held 15 min)</th>
              <th>Paid above reference</th>
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
                </td>
                <td className="num">{w.tokensAbove10}</td>
                <td>{w.biggest ? <span className="flex items-center gap-2"><Token ticker={w.biggest.ticker} size={18} /><span className="num">{`${w.biggest.peakPct >= 0 ? "+" : ""}${w.biggest.peakPct.toFixed(1)}%`}</span></span> : "–"}</td>
                <td className="num">{money(w.paidAboveReferenceUsd)}</td>
                <td className="num">{w.wallets.toLocaleString("en-US")}</td>
                <td className="text-xs text-ink-faint">{`${w.sample.activeTickers} tokens, ${w.sample.swaps.toLocaleString("en-US")} swaps`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Footnotes />
    </div>
  );
}
