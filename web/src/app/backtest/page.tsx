"use client";
import { useEffect, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import { EVENTS, loadBacktest, type BacktestDoc } from "@/lib/backtest";
import { pct } from "@/lib/format";

export default function Backtest() {
  const [docs, setDocs] = useState<BacktestDoc[]>([]);
  useEffect(() => {
    Promise.all(EVENTS.map(loadBacktest)).then(setDocs).catch(() => {});
  }, []);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Backtest: HIMS (28–31 Aug) and GLXY (12 Sep)</h1>
      <p className="text-sm text-ink-soft">Replayed on the real Uniswap v4 swaps of the deepest hook-free STOCK/USDG pool. Two real events, side by side.</p>
      <div className="grid gap-6 lg:grid-cols-2">
        {docs.map((d) => {
          const lock = d.summary.rows.filter((r) => r.variant === "lockOnFill");
          const mv = d.summary.metaVault?.exFees;
          return (
            <div key={d.id} className="card space-y-4">
              <div className="font-medium">{d.summary.ticker}</div>
              <PriceChart data={d.sim.timeline} p0={d.summary.p0Usd} band={d.summary.bandUsd} />
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="label">Friday close</div><div className="num">${d.summary.p0Usd.toFixed(2)}</div></div>
                <div><div className="label">Peak</div><div className="num">${d.summary.maxPoolUsd.toFixed(2)}</div></div>
                <div><div className="label">At settle</div><div className="num">${d.summary.settlePoolUsd.toFixed(2)}</div></div>
              </div>
              <table className="data">
                <thead><tr><th>Deployed</th><th>Avg sell</th><th>STOCK vs hold (ex-fees)</th></tr></thead>
                <tbody>
                  {lock.map((r) => (
                    <tr key={r.deployed}><td className="num">{r.deployed}</td><td className="num">{r.avgSellUsd ? `$${r.avgSellUsd.toFixed(2)}` : "–"}</td><td className="num">{pct(r.vsHodlPctExFees)}</td></tr>
                  ))}
                </tbody>
              </table>
              {mv && (
                <div className="rounded-md bg-paper p-3 text-sm">
                  <div className="label mb-1">MetaVault view (USDG, with friction)</div>
                  gross {pct(mv.grossUsdPct)} · friction −{mv.frictionPct.toFixed(2)}% · <b>net {pct(mv.netUsdPct)}</b>
                  <div className="text-xs text-ink-faint">Buy-in approximated at the Friday close; the real Thursday buy-in price differs.</div>
                </div>
              )}
              <ul className="list-disc space-y-1 pl-5 text-xs text-ink-faint">{d.caveats.map((c) => <li key={c}>{c}</li>)}</ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
