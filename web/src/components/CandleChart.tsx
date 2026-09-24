"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface Swap { t: number; usd: number }
export interface Candle { t: number; o: number; h: number; l: number; c: number; swaps: number }

/** OHLC candles from swap prices; empty buckets carry the last close forward as a flat candle. */
export function toCandles(swaps: Swap[], t0: number, t1: number, bucket: number): Candle[] {
  const out: Candle[] = [];
  let i = 0;
  let last = swaps[0]?.usd ?? 0;
  for (let t = t0; t < t1; t += bucket) {
    const c: Candle = { t, o: last, h: last, l: last, c: last, swaps: 0 };
    while (i < swaps.length && swaps[i].t < t + bucket) {
      const p = swaps[i].usd;
      if (swaps[i].t >= t) {
        if (c.swaps === 0) { c.o = last; c.h = Math.max(last, p); c.l = Math.min(last, p); }
        c.h = Math.max(c.h, p); c.l = Math.min(c.l, p); c.c = p; c.swaps++;
      }
      last = p;
      i++;
    }
    out.push(c);
  }
  return out;
}

/**
 * Broken time axis: if nothing moves more than `quiet`% from p0 for a long stretch, compress that stretch so the action
 * gets the width. Returns segments [t0, t1, f0, f1] mapping time to a 0..1 x fraction.
 */
export function autoSegments(swaps: Swap[], t0: number, t1: number, p0: number, quiet = 8): [number, number, number, number][] {
  const firstMove = swaps.find((s) => s.t > t0 + 12 * 3600 && Math.abs(s.usd / p0 - 1) * 100 > quiet)?.t;
  const a = t0 + 8 * 3600, b = (firstMove ?? t1) - 3 * 3600;
  if (!firstMove || b - a < 10 * 3600) return [[t0, t1, 0, 1]];
  return [[t0, a, 0, 0.2], [a, b, 0.2, 0.28], [b, t1, 0.28, 1]];
}

const UP = "#22C55E", DOWN = "#EF4444";

export function CandleChart({ swaps, t0, t1, p0, p0Label, reopenAt, ladder, bucket = 1800, height, tone = "dark", animate = false, onProgress }: {
  swaps: Swap[]; t0: number; t1: number; p0: number; p0Label?: string; reopenAt?: number; ladder?: [number, number][];
  bucket?: number; height?: number; tone?: "dark" | "light"; animate?: boolean; onProgress?: (tc: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [p, setP] = useState(animate ? 0 : 1);
  const [mounted, setMounted] = useState(false); // charts draw client-side only: no SSR/client attribute mismatches
  const dark = tone === "dark";
  const h = height ?? (w < 640 ? 250 : 360);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!animate) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setP(1);
    let raf = 0;
    const start = performance.now() + 300;
    const tick = (now: number) => {
      const x = Math.min(1, Math.max(0, (now - start) / 6500));
      setP(x);
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate]);

  const seg = useMemo(() => autoSegments(swaps, t0, t1, p0), [swaps, t0, t1, p0]);
  const xf = (t: number) => { for (const [a, b, f0, f1] of seg) if (t <= b) return f0 + ((Math.max(t, a) - a) / (b - a)) * (f1 - f0); return 1; };
  const tf = (f: number) => { for (const [a, b, f0, f1] of seg) if (f <= f1) return a + ((f - f0) / (f1 - f0)) * (b - a); return t1; };
  const candles = useMemo(() => {
    // finer candles where the action is
    const out: Candle[] = [];
    for (const [a, b, f0, f1] of seg) {
      const compressed = (f1 - f0) / ((b - a) / (t1 - t0)) < 0.5;
      out.push(...toCandles(swaps, a, b, compressed ? bucket * 6 : bucket));
    }
    return out;
  }, [swaps, seg, bucket, t0, t1]);

  const tc = Math.round(tf(p) / 60) * 60; // minute resolution: parents re-render at most once per chart-minute
  useEffect(() => { if (Number.isFinite(tc)) onProgress?.(tc); }, [tc]); // eslint-disable-line react-hooks/exhaustive-deps
  const visible = candles.filter((c) => c.t <= tc);
  const hi = Math.max(p0 * 1.6, ...swaps.map((s) => s.usd)) * 1.05, lo = Math.min(p0 * 0.9, ...swaps.map((s) => s.usd)) * 0.97;
  const pad = { l: 50, r: 14, t: 16, b: 30 };
  const sx = (t: number) => pad.l + xf(t) * (w - pad.l - pad.r);
  const sy = (v: number) => pad.t + (1 - (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))) * (h - pad.t - pad.b);
  const grid = dark ? "#23272A" : "#DCE5E3", faint = dark ? "#6B7478" : "#8A9396", text = dark ? "#9AA3A6" : "#4B5356";
  const ticks = [10, 20, 25, 30, 40, 50, 75, 100, 150, 200].filter((v) => v > lo && v < hi);
  const fmtT = (t: number) => { const d = new Date(t * 1000); return `${d.toUTCString().slice(0, 3)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`; };
  const crossed = (hiPct: number) => swaps.some((s) => s.t <= tc && s.usd >= p0 * (1 + hiPct / 100));
  const peak = visible.reduce((a, c) => (c.h > a.h ? c : a), visible[0] ?? { h: 0, t: t0 } as any);

  if (!mounted) return <div ref={box} className="relative w-full min-w-0" style={{ height: h }} />;
  return (
    <div ref={box} className="relative w-full min-w-0">
      <svg width={w} height={h} role="img" aria-label="Candlestick chart of the token price through the weekend">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={w - pad.r} y1={sy(v)} y2={sy(v)} stroke={grid} />
            <text x={pad.l - 8} y={sy(v) + 4} textAnchor="end" fontSize="11" fill={faint}>${v}</text>
          </g>
        ))}
        {seg.length === 3 && (
          <g>
            <rect x={sx(seg[1][0])} y={pad.t} width={sx(seg[1][1]) - sx(seg[1][0])} height={h - pad.t - pad.b} fill={dark ? "#0F1112" : "#E3EAE9"} opacity={0.6} />
            {[sx(seg[1][0]) + 3, sx(seg[1][1]) - 9].map((x) => <path key={x} d={`M${x},${h - pad.b + 5} l6,-10`} stroke={faint} strokeWidth={1.2} />)}
            {w >= 560 && <text x={(sx(seg[1][0]) + sx(seg[1][1])) / 2} y={h - 10} textAnchor="middle" fontSize="11" fill={faint}>≈{Math.round((seg[1][1] - seg[1][0]) / 3600)} h flat</text>}
          </g>
        )}
        {reopenAt && (
          <g>
            <line x1={sx(reopenAt)} x2={sx(reopenAt)} y1={pad.t} y2={h - pad.b} stroke={dark ? "#4B5356" : "#B9C4C2"} strokeDasharray="3 3" />
            <text x={sx(reopenAt) - 6} y={h - pad.b - 8} textAnchor="end" fontSize="11" fill={tc >= reopenAt ? (dark ? "#F4F7F7" : "#161819") : faint}>minting reopens</text>
          </g>
        )}
        {ladder?.map(([loPct, hiPct], i) => {
          const on = crossed(hiPct);
          const x0 = sx(t0) + 6 + i * 12;
          const x1 = reopenAt ? sx(reopenAt) : w - pad.r;
          return (
            <rect key={loPct} x={x0} y={sy(p0 * (1 + hiPct / 100))} width={Math.max(0, x1 - x0 - 2)} height={sy(p0 * (1 + loPct / 100)) - sy(p0 * (1 + hiPct / 100))} rx={2}
              fill={on ? "#3BE3EE" : "transparent"} fillOpacity={on ? 0.16 : 0} stroke={on ? "#3BE3EE" : dark ? "#34393C" : "#C7D1CF"} strokeWidth={1} />
          );
        })}
        <line x1={pad.l} x2={w - pad.r} y1={sy(p0)} y2={sy(p0)} stroke={text} strokeDasharray="5 4" />
        {p0Label && <text x={pad.l + 6} y={sy(p0) + 15} textAnchor="start" fontSize="11" fill={text}>{p0Label}</text>}
        {visible.map((c, i) => {
          const next = candles[candles.indexOf(c) + 1]?.t ?? t1;
          const cw = Math.max(1, (sx(next) - sx(c.t)) * 0.7);
          const x = sx(c.t) + (sx(next) - sx(c.t) - cw) / 2;
          const up = c.c >= c.o;
          const col = c.swaps === 0 ? faint : up ? UP : DOWN;
          const yo = sy(Math.max(c.o, c.c)), yc = sy(Math.min(c.o, c.c));
          return (
            <g key={c.t}>
              <line x1={x + cw / 2} x2={x + cw / 2} y1={sy(c.h)} y2={sy(c.l)} stroke={col} strokeWidth={1} />
              <rect x={x} y={yo} width={cw} height={Math.max(1, yc - yo)} fill={col} opacity={i === visible.length - 1 && p < 1 ? 0.7 : 1} />
            </g>
          );
        })}
        {peak && peak.h > p0 * 1.3 && p >= 1 && (
          <text x={sx(peak.t) - 8} y={sy(peak.h) + 4} textAnchor="end" fontSize="12" fill="#3BE3EE">peak ${peak.h.toFixed(2)}</text>
        )}
        {[t0, ...(reopenAt ? [reopenAt] : [])].map((t, i) => (
          <text key={t} x={sx(t)} y={h - 10} textAnchor={i === 0 ? "start" : "middle"} fontSize="11" fill={faint}>{fmtT(t)}</text>
        ))}
      </svg>
    </div>
  );
}
