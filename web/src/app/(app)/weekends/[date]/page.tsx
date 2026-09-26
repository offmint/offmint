import Link from "next/link";
import { notFound } from "next/navigation";
import { Token } from "@/components/TokenLogo";
import { WEEKENDS, windowOf, windowDates, money } from "@/lib/weekends";
import { Footnotes } from "@/components/WeekendFootnotes";

export function generateStaticParams() {
  return WEEKENDS.windows.map((w) => ({ date: w.window }));
}

const pctText = (x: number | null) => (x === null ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`);

/** Feature 2 detail: per token in one mint-off window. */
export default async function WeekendDetail({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const w = windowOf(date);
  if (!w) notFound();
  const th = WEEKENDS.headlineThresholdPct;
  const all = [...w.tokens].sort((a, b) => b.paidAboveReferenceUsd - a.paidAboveReferenceUsd || (b.peakPct ?? -1e9) - (a.peakPct ?? -1e9));
  // quiet tokens (nothing paid above the headline threshold and a peak under it) are folded away, not hidden
  const loud = (t: (typeof all)[number]) => t.paidAboveReferenceUsd > 0 || (t.peakPct ?? 0) >= th;
  const tokens = all.filter(loud);
  const quiet = all.filter((t) => !loud(t));
  return (
    <div className="space-y-6">
      <Link href="/weekends" className="text-sm text-tide hover:underline">← All windows</Link>
      <div>
        <h1 className="text-2xl font-semibold">{windowDates(w)}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {`${w.reason}, ${w.hours} hours with minting off. Reference: official close on ${w.refDate}.`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <div className="card"><div className="label">Tokens above 10%</div><div className="num text-xl">{w.tokensAbove10}</div></div>
        <div className="card"><div className="label">{`Value of buys priced >${th}% above the reference`}</div><div className="num text-xl">{money(w.buysValueUsd)}</div><div className="text-xs text-ink-faint">{`${w.buysAbove.toLocaleString("en-US")} buys`}</div></div>
        <div className="card"><div className="label">Paid above the reference on those buys</div><div className="num text-xl">{money(w.paidAboveReferenceUsd)}</div></div>
        <div className="card"><div className="label">Wallets</div><div className="num text-xl">{w.wallets.toLocaleString("en-US")}</div></div>
        <div className="card"><div className="label">Sample</div><div className="num text-xl">{`${w.sample.activeTickers} tokens`}</div><div className="text-xs text-ink-faint">{`${w.sample.swaps.toLocaleString("en-US")} swaps`}</div></div>
      </div>
      <p className="text-xs text-ink-faint">{`At the looser 2% threshold: ${money(w.detail2pct.buysValueUsd)} of buys, ${money(w.detail2pct.paidAboveReferenceUsd)} paid above the reference on them, by ${w.detail2pct.wallets.toLocaleString("en-US")} wallets.`}</p>
      <div className="overflow-x-auto">
        <table className="data min-w-[860px]">
          <thead>
            <tr>
              <th>Token</th>
              <th>Peak (held 15 min)</th>
              <th>Hours above 10%</th>
              <th>{`Value of buys >${th}% above`}</th>
              <th>Paid above the reference</th>
              <th>Wallets</th>
              <th>Back within 5% after reopen</th>
              <th>Community vault (simulated, per $1k)</th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => {
              const v = t.vault.bySize?.["1000"];
              return (
                <tr key={t.ticker}>
                  <td><Token ticker={t.ticker} size={18} /></td>
                  <td className="num">{pctText(t.peakPct)}</td>
                  <td className="num">{t.hoursAbove10 === null ? "–" : t.hoursAbove10.toFixed(1)}</td>
                  <td className="num">{money(t.buysValueUsd)}</td>
                  <td className="num">{money(t.paidAboveReferenceUsd)}</td>
                  <td className="num">{t.wallets.toLocaleString("en-US")}</td>
                  <td className="num">{t.recovery ? (t.recovery.hours === null ? "not within 72 h" : `${t.recovery.hours.toFixed(1)} h`) : "–"}</td>
                  <td className="text-sm">{v?.excessPctExLpFees != null ? <span className="num">{pctText(v.excessPctExLpFees)}</span> : <span className="text-xs text-ink-faint">{t.vault.label ? "no fill" : "not replayed"}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {quiet.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-ink-soft">{`${quiet.length} more tokens stayed within ${th}% of the reference`}</summary>
          <p className="mt-2 text-ink-faint">{quiet.map((t) => t.ticker).join(", ")}</p>
        </details>
      )}
      <p className="text-xs text-ink-faint">
        Community vault: &quot;no fill&quot; = the price never reached the first sell step (+8%), so nothing sold (gas only);
        &quot;not replayed&quot; = the token is outside the 45 tokens our replay covers. Peak = the highest premium the token&apos;s most active pool held for 15 minutes (single stray trades ignored); hours above 10% on the same pool; tokens with fewer than 10
        swaps in the window show &quot;–&quot;. Community vault: default ladder, with our own orders in the pool, excluding
        LP fee income, after the 10% fee on profit (simulated, web/public/data/supply/replay.json).
      </p>
      <Footnotes />
    </div>
  );
}
