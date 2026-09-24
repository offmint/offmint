"use client";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface Pt { t: number; usd: number }

/** Pool price through a weekend, with the reference close (P0) and the sell band. */
export function PriceChart({ data, p0, band, height = 260 }: { data: Pt[]; p0?: number; band?: [number, number]; height?: number }) {
  const fmt = (t: number) => new Date(t * 1000).toISOString().slice(5, 16).replace("T", " ");
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#ecebe6" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={fmt} tick={{ fontSize: 11, fill: "#8a95a1" }} minTickGap={40} />
        <YAxis tick={{ fontSize: 11, fill: "#8a95a1" }} width={48} domain={["auto", "auto"]} tickFormatter={(v) => `$${v}`} />
        <Tooltip labelFormatter={(t) => `${fmt(Number(t))} UTC`} formatter={(v: number) => [`$${v.toFixed(2)}`, "pool"]} />
        {band && <ReferenceArea y1={band[0]} y2={band[1]} fill="#1f5f8b" fillOpacity={0.08} />}
        {p0 && <ReferenceLine y={p0} stroke="#8a95a1" strokeDasharray="4 4" label={{ value: "Friday close", fontSize: 10, fill: "#8a95a1", position: "insideBottomRight" }} />}
        <Line type="stepAfter" dataKey="usd" stroke="#1f5f8b" dot={false} strokeWidth={1.6} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
