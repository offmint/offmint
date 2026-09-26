"use client";
import type { SandboxRun } from "@/lib/sandbox";
import { SAT, MON } from "@/lib/sandbox";

const W = 760, H = 300, P = { l: 56, r: 64, t: 22, b: 30 };
const TEAL = "#0E9F9A", GREY = "#9AA3A6", INK = "#161819", CAP = "#B45309";

/** Price over the simulated weekend, revealed up to `until`: without Offmint (grey) vs with the vault's orders (teal). */
export function SandboxChart({ run, until }: { run: SandboxRun; until: number }) {
  const t0 = SAT, t1 = MON + 3600;
  const hi = Math.max(run.peakWithout, run.capUsd, ...run.rungs.map((r) => r.toUsd)) * 1.05;
  const lo = Math.min(run.refUsd, run.freshUsd) * 0.92;
  const x = (t: number) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (u: number) => P.t + (1 - (u - lo) / (hi - lo)) * (H - P.t - P.b);
  const pts = run.series.filter((p) => p.t <= until);
  const path = (k: "without" | "withVault") => pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p[k]).toFixed(1)}`).join("");
  // y labels: top, reference, and the peak; drop any that would collide (< 14 px apart)
  const ticks: number[] = [];
  for (const v of [hi / 1.05, run.refUsd, run.peakWithout]) if (ticks.every((u) => Math.abs(y(u) - y(v)) >= 14)) ticks.push(v);
  const overlap = pts.every((p) => Math.abs(p.without - p.withVault) / p.without < 0.005);
  return (
    <div>
      {/* on phones the chart keeps a readable size and scrolls sideways instead of shrinking its labels */}
      <div className="-mx-1 overflow-x-auto px-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px]" role="img" aria-label="Simulated weekend price: without Offmint and with the vault's sell steps">
        {/* weekend (minting off) */}
        <rect x={x(SAT)} y={P.t} width={x(MON) - x(SAT)} height={H - P.t - P.b} fill="#EEF2F2" />
        <text x={x(SAT) + 6} y={P.t - 6} fontSize="11" fill={GREY}>minting off (weekend)</text>
        {/* ladder steps, labelled at the left edge */}
        {run.rungs.map((r) => (
          <g key={r.premiumPct}>
            <rect x={P.l} y={y(r.toUsd)} width={x(MON - 900) - P.l} height={Math.max(1.5, y(r.fromUsd) - y(r.toUsd))} fill={TEAL} opacity={0.14} />
            {y(r.fromUsd) - y(r.toUsd) >= 9 && <text x={P.l + 6} y={y(r.fromUsd) - 2} fontSize="10" fill={TEAL}>{`step +${r.premiumPct}%`}</text>}
          </g>
        ))}
        {/* reference */}
        <line x1={P.l} x2={W - P.r} y1={y(run.refUsd)} y2={y(run.refUsd)} stroke={INK} strokeDasharray="4 4" strokeWidth={1} />
        <text x={W - P.r + 4} y={y(run.refUsd) + 4} fontSize="10" fill={INK}>real price</text>
        {until >= MON && (
          <g>
            <line x1={x(MON)} x2={x(MON)} y1={P.t} y2={H - P.b} stroke={INK} strokeWidth={1} />
            <text x={x(MON) + 4} y={P.t - 6} fontSize="11" fill={INK}>reopen</text>
            <line x1={x(MON)} x2={W - P.r} y1={y(run.capUsd)} y2={y(run.capUsd)} stroke={CAP} strokeWidth={1.5} />
            <text x={W - P.r + 4} y={y(run.capUsd) - 6} fontSize="10" fill={CAP}>buyback cap</text>
          </g>
        )}
        <path d={path("without")} fill="none" stroke={GREY} strokeWidth={4} opacity={0.8} />
        <path d={path("withVault")} fill="none" stroke={TEAL} strokeWidth={2} />
        {/* axes */}
        {ticks.map((v) => <text key={v} x={P.l - 6} y={y(v) + 4} fontSize="10" textAnchor="end" fill={GREY}>{`$${v.toFixed(2)}`}</text>)}
        {[["Sat", SAT], ["Sun", SAT + 86_400], ["Mon", MON]].map(([l, t]) => <text key={l as string} x={x(t as number)} y={H - 10} fontSize="11" fill={GREY}>{l as string}</text>)}
      </svg>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span className="flex items-center gap-1.5"><span className="inline-block h-1 w-5 rounded" style={{ background: GREY }} />price without Offmint</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: TEAL }} />with the vault&apos;s sell steps in the pool</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-5" style={{ background: TEAL, opacity: 0.14 }} />sell steps</span>
        {until >= MON && <span className="flex items-center gap-1.5"><span className="inline-block h-0.5 w-5" style={{ background: CAP }} />{`buyback cap $${run.capUsd.toFixed(2)}`}</span>}
      </div>
      {overlap && pts.length > 1 && <p className="mt-1 text-xs text-ink-faint">The two lines overlap: at this size the vault&apos;s steps barely move the price. Make the pool thinner or the deposit bigger to see them pull the spike down.</p>}
    </div>
  );
}
