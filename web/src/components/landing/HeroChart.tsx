"use client";
import { useMemo, useState } from "react";
import hims from "../../../public/data/backtest/hims-2026-08-28.json";
import { CandleChart } from "@/components/CandleChart";
import { EVENTS, LADDER as LADDER_DATA } from "@/lib/claims";

// The real HIMS weekend (29–31 Aug 2026): every swap on the deepest hook-free HIMS/USDG Uniswap v4 pool, as candles.
// Reference P0 is read from the weekend screen (pool price at Fri 20:00 UTC), the same reference as the +317.6% figure.
// The ladder is Offmint's default, read from the contract source (web/public/data/params.json).
const EV = EVENTS[0];
const P0 = EV.p0;
const LADDER = LADDER_DATA;
const RAW = (hims as any).sim.timeline as { t: number; usd: number }[];
const WIN = (hims as any).sim.window as { start: number; end: number };
const T1 = RAW[RAW.length - 1].t;

const fmtT = (t: number) => {
  const d = new Date(t * 1000);
  return `${d.toUTCString().slice(0, 3)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export function HeroChart() {
  // Start on the final frame: no-JS and reduced-motion visitors see the finished weekend; the chart's animation rewinds it.
  const [tc, setTc] = useState(T1);
  const crossings = useMemo(() => LADDER.map(([, hi]) => RAW.find((d) => d.usd >= P0 * (1 + hi / 100))?.t ?? null), []);
  let k = 0;
  while (k < RAW.length - 1 && RAW[k + 1].t <= tc) k++;
  const price = RAW[k]?.usd ?? P0;
  const peak = RAW.slice(0, k + 1).reduce((a, d) => Math.max(a, d.usd), 0);
  const reopened = tc >= WIN.end;
  const reached = crossings.filter((c) => c !== null && c <= tc).length;

  return (
    <div className="grid overflow-hidden rounded-[12px] border border-graphite bg-matte text-paper-text lg:grid-cols-[320px_1fr]">
      <div className="flex flex-col gap-5 border-b border-graphite p-5 lg:border-b-0 lg:border-r">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded-[6px] bg-graphite px-1.5 py-0.5 text-[11px] font-semibold">HIMS</span>
            <span className="text-xs text-[#9AA3A6]">29–31 Aug 2026</span>
          </div>
          <span className={`rounded-[6px] px-2 py-0.5 text-[11px] font-medium ${reopened ? "border border-graphite text-[#C9D1D3]" : "bg-glow text-matte"}`}>
            {reopened ? "Minting on" : "Minting off"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <div>
            <div className="text-xs text-[#9AA3A6]">Token price</div>
            <div className="fig text-[34px] font-semibold leading-none">${price.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-[#9AA3A6]">Peak over Friday&apos;s price</div>
            <div className="fig text-[34px] font-semibold leading-none text-glow">+{Math.max(0, (peak / P0 - 1) * 100).toFixed(1)}%</div>
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs text-[#9AA3A6]">Offmint&apos;s sell steps, sold through at (UTC)</div>
          <ul className="space-y-1.5 text-[13px]">
            {LADDER.map(([lo, hi], i) => {
              const on = crossings[i] !== null && crossings[i]! <= tc;
              return (
                <li key={lo} className={`flex items-center justify-between gap-3 whitespace-nowrap ${on ? "" : "text-[#6B7478]"}`}>
                  <span className="flex items-center gap-2">
                    <span className={`inline-block h-2 w-2 rounded-[2px] ${on ? "bg-glow" : "border border-[#4B5356]"}`} />
                    <span className="num">+{lo}–{hi}%</span>
                  </span>
                  <span className="num text-[#9AA3A6]">{on ? fmtT(crossings[i]!) : "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-auto text-[11px] leading-snug text-[#9AA3A6]">
          {reached}/4 sell steps reached. 15-min candles from every swap on the deepest hook-free HIMS/USDG Uniswap v4 pool,
          Robinhood Chain mainnet. Reference ${P0.toFixed(2)} is the pool price at Fri 20:00 UTC{EV.nyseClose !== null ? ` (NYSE close $${EV.nyseClose.toFixed(2)})` : ""}.
        </div>
      </div>
      <div className="min-w-0 p-2 sm:p-3">
        <CandleChart swaps={RAW} t0={WIN.start} t1={T1} p0={P0} p0Label={`Friday price $${P0.toFixed(2)}`} reopenAt={WIN.end}
          ladder={LADDER} bucket={900} animate onProgress={setTc} />
      </div>
    </div>
  );
}
