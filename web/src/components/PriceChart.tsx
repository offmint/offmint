"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Pt { t: number; usd: number }

/** Offmint's 4-rung default ladder (SPEC §5.0): premium over Friday's price, width, share. */
export const LADDER = [
  { premiumBps: 800, widthBps: 400 },
  { premiumBps: 1500, widthBps: 700 },
  { premiumBps: 2500, widthBps: 1000 },
  { premiumBps: 4000, widthBps: 1500 },
];

/**
 * One chart language (docs/ASSETS.md §4): token price as a solid line, the reference (Friday close) dashed and neutral,
 * the premium gap above it shaded Glow cyan (the only cyan on the chart), and the sell rungs as steps above the reference.
 */
export function PriceChart({ data, p0, height = 260, tone = "light", caption, rungs = true }: {
  data: Pt[]; p0?: number; height?: number; tone?: "light" | "dark"; caption?: string; rungs?: boolean;
}) {
  const dark = tone === "dark";
  const line = dark ? "#F4F7F7" : "#161819";
  const grid = dark ? "#2B2F31" : "#E3EAE9";
  const tick = dark ? "#9AA3A6" : "#8A9396";
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  const rows = data.map((d) => ({ ...d, gap: p0 ? [p0, Math.max(d.usd, p0)] : undefined }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={grid} vertical={false} />
          <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tick={{ fontSize: 11, fill: tick }} minTickGap={48} stroke={grid} />
          <YAxis tick={{ fontSize: 11, fill: tick }} width={46} domain={[0, "auto"]} tickFormatter={(v) => `$${Math.round(v)}`} stroke={grid} />
          <Tooltip
            contentStyle={{ background: dark ? "#161819" : "#fff", border: `1px solid ${grid}`, fontSize: 12 }}
            labelFormatter={(t) => `${fmt(Number(t))} UTC`}
            formatter={(v: any, name: string) => (name === "usd" ? [`$${Number(v).toFixed(2)}`, "token price"] : [null, null]) as any}
          />
          {p0 && <Area type="stepAfter" dataKey="gap" stroke="none" fill="#3BE3EE" fillOpacity={dark ? 0.35 : 0.45} isAnimationActive={false} />}
          {p0 && rungs && LADDER.map((r, i) => (
            <ReferenceLine key={i} y={p0 * (1 + r.premiumBps / 10_000)} stroke={dark ? "#4B5356" : "#B9C4C2"} strokeWidth={1}
              label={i === LADDER.length - 1 ? { value: "sell steps", fill: tick, fontSize: 10, position: "insideTopLeft" } : undefined} />
          ))}
          {p0 && <ReferenceLine y={p0} stroke={tick} strokeDasharray="5 4" label={{ value: "Friday close", fill: tick, fontSize: 10, position: "insideBottomLeft" }} />}
          <Line type="stepAfter" dataKey="usd" stroke={line} dot={false} strokeWidth={1.5} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      {caption && <div className={`mt-1 text-[11px] ${dark ? "text-[#9AA3A6]" : "text-ink-faint"}`}>{caption}</div>}
    </div>
  );
}
