"use client";
import { useEffect, useState } from "react";
import { PAPER_API } from "@/lib/config";
import { CandleChart } from "@/components/CandleChart";
import { Token } from "@/components/TokenLogo";
import { pct } from "@/lib/format";

interface Entry { file: string; ticker: string; window: string; status: string; maxPremiumPct: number | null; vsHodlPct: number | null }
const CONTROLS = ["NVDA", "SPY"];

/** Live paper mode (read-only mainnet simulation), per ticker and weekend, served by the Railway keeper service. */
export default function Paper() {
  const [idx, setIdx] = useState<Entry[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  useEffect(() => {
    fetch(`${PAPER_API}/paper/index.json`).then((r) => r.json()).then((d) => setIdx(d.entries)).catch(() => setIdx([]));
  }, []);
  const open = (f: string) => fetch(`${PAPER_API}/paper/${f}`).then((r) => r.json()).then(setSel);
  const windows = [...new Set((idx ?? []).map((e) => e.window))].sort().reverse();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Paper mode</h1>
      <p className="text-sm text-ink-soft">The unmodified keeper logic run against live mainnet pools every weekend, with no funds. Every basket member plus NVDA / SPY as controls (majors should stay calm). Hypothetical: the position is assumed not to move the pool.</p>
      {windows.map((w) => {
        const rows = (idx ?? []).filter((e) => e.window === w).sort((a, b) => (b.maxPremiumPct ?? -1) - (a.maxPremiumPct ?? -1));
        return (
          <div key={w} className="card overflow-x-auto">
            <div className="label mb-2">Weekend of {w.slice(0, 10)} · {rows.length} tickers</div>
            <table className="data">
              <thead><tr><th>Ticker</th><th>Status</th><th>Max premium over Friday close</th><th>STOCK vs hold</th><th></th></tr></thead>
              <tbody>{rows.map((e) => (
                <tr key={e.file}>
                  <td className="font-medium"><Token ticker={e.ticker} size={22} />{CONTROLS.includes(e.ticker) ? <span className="ml-1 text-xs text-ink-faint">control</span> : null}</td>
                  <td className="text-xs">{e.status}</td>
                  <td className="num">{e.maxPremiumPct != null ? pct(e.maxPremiumPct) : "–"}</td>
                  <td className="num">{e.vsHodlPct != null ? pct(e.vsHodlPct) : "–"}</td>
                  <td><button className="text-xs underline" onClick={() => open(e.file)}>chart</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        );
      })}
      {idx?.length === 0 && <div className="text-sm text-ink-faint">Paper service unreachable or no weekends recorded yet.</div>}
      {sel && (
        <div className="card">
          <div className="mb-2 flex items-center gap-2 font-medium"><Token ticker={sel.ticker} size={24} /> · weekend of {sel.window?.startIso?.slice(0, 10)}</div>
          <div className="rounded-[12px] bg-matte p-3">{(sel.timeline?.length ?? 0) > 1 ? <CandleChart swaps={sel.timeline} t0={sel.window.start} t1={Math.max(sel.window.end, sel.timeline[sel.timeline.length - 1].t)} p0={sel.arm?.p0Usd ?? sel.timeline[0].usd} p0Label="Friday price" reopenAt={sel.window.end} bucket={1800} height={300} /> : <div className="p-6 text-sm text-[#9AA3A6]">No swaps recorded for this weekend.</div>}</div>
          <p className="mt-2 text-xs text-ink-faint">Source: live mainnet pool swaps, weekend of {sel.window?.startIso?.slice(0, 10)} (paper mode, Railway service). 30-min candles.</p>
          <p className="mt-2 text-xs text-ink-faint">{sel.caveat}</p>
        </div>
      )}
    </div>
  );
}
