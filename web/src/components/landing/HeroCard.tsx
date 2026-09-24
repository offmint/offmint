"use client";
import { useEffect, useState } from "react";
import { HERO_RUN as R } from "@/content/landing";

// One weekend, played once on load (~6 s), then resting on the final frame. Numbers are from a real local run.
// Stages: 0 weekday · 1 minting off · 2..5 rungs fill · 6 Monday buyback · 7 result
const STAGES = 8;
const W = 520, H = 230, PAD = { l: 44, r: 12, t: 14, b: 22 };
const yMin = 24, yMax = 52;
const X = { fri: 0.28, spike: 0.52, mon: 0.8 }; // fractions of the plot width
const sx = (f: number) => PAD.l + f * (W - PAD.l - PAD.r);
const sy = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
const WIDTHS = [4, 7, 10, 15]; // rung widths in % above its premium (SPEC §5.0 default ladder)

export function HeroCard() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return setStage(STAGES - 1);
    const timers = [700, 1300, 1900, 2500, 3100, 4300, 5300].map((ms, i) => setTimeout(() => setStage(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const off = stage >= 1 && stage < 6;
  const filled = Math.max(0, Math.min(4, stage - 1));
  // price path: flat to Friday, spike through the rungs over the weekend, back down on Monday
  const peakX = X.fri + ((X.spike - X.fri) * filled) / 4;
  const peakV = filled === 0 ? R.p0 : filled < 4 ? R.p0 * (1 + (R.rungs[filled - 1].premiumPct + WIDTHS[filled - 1]) / 100) : R.peak;
  const pts: [number, number][] = [[0, R.p0], [X.fri, R.p0]];
  if (stage >= 2) pts.push([peakX, peakV]);
  if (stage >= 5) pts.push([X.mon - 0.02, R.peak]);
  if (stage >= 6) pts.push([X.mon, R.monday], [1, R.monday]);
  const path = pts.map(([f, v], i) => `${i ? "L" : "M"}${sx(f).toFixed(1)},${sy(v).toFixed(1)}`).join(" ");
  const avg = (i: number) => R.rungs[i].usdg / R.rungs[i].sold;

  return (
    <div className="rounded-[12px] border border-graphite bg-matte p-4 text-paper-text shadow-[0_24px_60px_-30px_rgba(22,24,25,0.6)] sm:p-5" aria-label="One simulated weekend on the HIMS pool">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-[6px] bg-graphite px-1.5 py-0.5 text-[11px] font-semibold">{R.ticker}</span>
          <span className="text-xs text-[#9AA3A6]">stock token · weekend replay</span>
        </div>
        <span className={`rounded-[6px] px-2 py-0.5 text-[11px] font-medium transition-colors ${off ? "bg-glow text-matte" : "border border-graphite text-[#C9D1D3]"}`}>
          {off ? "Minting off" : "Minting on"}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="Price chart with the four sell steps above Friday's close">
        {[30, 40, 50].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="#2B2F31" />
            <text x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" fontSize="12" fill="#9AA3A6" className="num">${v}</text>
          </g>
        ))}
        {/* weekend shading */}
        <rect x={sx(X.fri)} y={PAD.t} width={sx(X.mon) - sx(X.fri)} height={H - PAD.t - PAD.b} fill="#2B2F31" opacity={off || stage >= 6 ? 0.55 : 0.25} />
        {/* the sell ladder: four steps, staggered like the logo's staircase */}
        {R.rungs.map((r, i) => {
          const lo = R.p0 * (1 + r.premiumPct / 100), hi = R.p0 * (1 + (r.premiumPct + WIDTHS[i]) / 100);
          const x0 = sx(X.fri + 0.015 + i * 0.075); // staircase: each step starts further right
          const isFilled = i < filled || stage >= 6;
          return (
            <rect key={i} x={x0} y={sy(hi)} width={sx(X.mon) - x0} height={sy(lo) - sy(hi)} rx={2}
              fill={isFilled ? "#3BE3EE" : "none"} fillOpacity={isFilled ? 0.3 : 0} stroke={isFilled ? "#3BE3EE" : "#4B5356"} strokeWidth={1} />
          );
        })}
        <line x1={PAD.l} x2={W - PAD.r} y1={sy(R.p0)} y2={sy(R.p0)} stroke="#9AA3A6" strokeDasharray="4 4" />
        <text x={PAD.l + 4} y={sy(R.p0) + 13} fontSize="12" fill="#9AA3A6">Friday close ${R.p0.toFixed(2)}</text>
        <path d={path} fill="none" stroke="#F4F7F7" strokeWidth={2} strokeLinejoin="round" />
        <text x={sx(X.fri)} y={H - 6} fontSize="12" fill="#9AA3A6" textAnchor="middle">Sat 00:00</text>
        <text x={sx(X.mon)} y={H - 6} fontSize="12" fill="#9AA3A6" textAnchor="middle">Mon 00:00</text>
      </svg>

      <ul className="mt-2 min-h-[132px] space-y-1 text-[13px]">
        {R.rungs.map((r, i) => i < filled || stage >= 6 ? (
          <li key={i} className="flex justify-between"><span><span className="text-glow">●</span> Rung {i + 1} filled</span><span className="num text-[#C9D1D3]">sold {r.sold.toFixed(2)} @ ${avg(i).toFixed(2)}</span></li>
        ) : null)}
        {stage >= 6 && (
          <li className="flex justify-between"><span>Monday: bought back, capped</span><span className="num text-[#C9D1D3]">{R.boughtBack.toFixed(2)} @ ${(R.boughtBackUsdg / R.boughtBack).toFixed(2)}</span></li>
        )}
      </ul>
      <div className="mt-3 flex items-baseline justify-between border-t border-graphite pt-3">
        <span className="text-sm text-[#C9D1D3]">Shares</span>
        <span className="fig text-2xl font-semibold">
          {R.sharesBefore.toFixed(2)} <span className="text-[#9AA3A6]">→</span> <span className={stage >= 7 ? "text-glow" : "text-[#9AA3A6]"}>{stage >= 7 ? R.sharesAfter.toFixed(2) : "…"}</span>
        </span>
      </div>
      <div className="mt-1 text-[11px] text-[#9AA3A6]">{R.source}. After the 10% performance fee.</div>
    </div>
  );
}
