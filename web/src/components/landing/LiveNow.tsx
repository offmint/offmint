"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { sessionNow } from "./StatBand";
import { Token } from "@/components/TokenLogo";
import { GATE } from "@/lib/liveGate";
import { fetchLive } from "@/lib/liveFetch";

interface Row { ticker: string; token: string; poolUsd: number | null; refUsd: number | null; premiumPct: number | null; depthUsdTo10: number; poolAgeDays: number; verified: boolean; reasons: string[] }
interface Live { basket: { live: boolean; count: number | null }; rows: Row[]; updatedAt: string; verifiedCount: number }

const usd = (x: number | null, d = 2) => (x === null ? "—" : `$${x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);

/** §7: the basket right now, top 8 by premium. */
export function LiveNow() {
  const [live, setLive] = useState<Live | null | "error">(null);
  useEffect(() => {
    const load = () => fetchLive<Live>().then(setLive).catch(() => setLive("error"));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  const L = live && live !== "error" ? live : null;
  const rows = (L?.rows ?? []).filter((r) => r.verified && r.premiumPct !== null).sort((a, b) => b.premiumPct! - a.premiumPct!).slice(0, 8);
  const total = L?.rows.length ?? 0;
  const session = sessionNow(Date.now()).off ? "Minting off" : "Minting on";
  return (
    <section id="live" className="border-y border-paper-line bg-paper-card">
      <div className="gutter py-16">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="h-section text-[40px] md:text-[64px]">Live now</h2>
          <Link href="/monitor" className="text-sm font-medium text-tide underline underline-offset-4">Open live monitor</Link>
        </div>
        <p className="mt-2 max-w-[64ch] text-ink-soft">Verified live premiums only: every row passed the quality checks below. {L ? `${L.verifiedCount} of ${total} basket tokens pass right now; the top ${rows.length} are shown.` : ""}</p>
        <div className="mt-6 overflow-x-auto rounded-[12px] border border-paper-line">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-mist text-left text-xs text-ink-faint">
              <tr>{["Ticker", "Token price", "Reference", "Premium", "$ to move +10%", "Session"].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {live === null && <tr><td colSpan={6} className="px-4 py-6 text-ink-faint">Loading…</td></tr>}
              {live !== null && rows.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-6 text-ink-soft">{L?.basket.live === false || live === "error" ? "Live data is updating. Try again in a minute." : "No verified premiums right now. The live monitor lists every basket token with the reason it did not pass."}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.token} className="border-t border-paper-line">
                  <td className="px-4 py-3"><Token ticker={r.ticker} size={22} /></td>
                  <td className="num px-4 py-3">{usd(r.poolUsd)}</td>
                  <td className="num px-4 py-3 text-ink-soft">{usd(r.refUsd)}</td>
                  <td className={`num px-4 py-3 font-medium ${r.premiumPct! >= 5 ? "text-tide" : ""}`}>{r.premiumPct! >= 0 ? "+" : ""}{r.premiumPct!.toFixed(2)}%</td>
                  <td className="num px-4 py-3 text-ink-soft">{usd(r.depthUsdTo10, 0)}</td>
                  <td className="px-4 py-3 text-ink-soft">{session}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-ink-faint">
          Live. Token price: the deepest hook-free Uniswap v4 pool, read onchain. Reference: Robinhood&apos;s Stock Token API quote (multiplier-adjusted).
          {`Verified = pool TVL ≥ $${GATE.minTvlUsd.toLocaleString("en-US")}, a $1,000 swap moves it < ${GATE.maxImpact1kPct}%, a swap in the last ${GATE.maxLastSwapAgeSec / 3600} h, quote spread ≤ ${GATE.maxRefSpreadPct}% and not halted, and GeckoTerminal agrees within ${GATE.maxIndependentDiffPct}%.`} Refreshed every 60 s
          {L ? `; updated ${new Date(L.updatedAt).toISOString().slice(11, 16)} UTC` : ""}.
        </p>
      </div>
    </section>
  );
}
