"use client";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface EvidenceProps {
  timeline: { t: number; usd: number }[];
  p0: number;
  p0Label: string;
  reopenAt: number; // unix seconds, minting reopens (window end)
}

/** Dark evidence chart: token price, Friday reference dashed, premium gap in Glow, "minting reopens" marker, peak dot. */
export function EvidenceChart({ timeline, p0, p0Label, reopenAt }: EvidenceProps) {
  const rows = timeline.map((d) => ({ ...d, gap: [p0, Math.max(d.usd, p0)] as [number, number] }));
  const peak = timeline.reduce((a, b) => (b.usd > a.usd ? b : a), timeline[0]);
  const day = (t: number) => new Date(t * 1000).toUTCString().slice(0, 3) + " " + new Date(t * 1000).toISOString().slice(11, 16);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={rows} margin={{ top: 22, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid stroke="#2B2F31" vertical={false} />
        <XAxis dataKey="t" type="number" domain={["dataMin", "dataMax"]} tickFormatter={day} tick={{ fontSize: 11, fill: "#9AA3A6" }} stroke="#2B2F31" minTickGap={60} />
        <YAxis tick={{ fontSize: 11, fill: "#9AA3A6" }} width={42} tickFormatter={(v) => `$${Math.round(v)}`} stroke="#2B2F31" domain={[0, "auto"]} />
        <Area type="stepAfter" dataKey="gap" stroke="none" fill="#3BE3EE" fillOpacity={0.35} isAnimationActive={false} />
        <ReferenceLine y={p0} stroke="#9AA3A6" strokeDasharray="5 4" label={{ value: p0Label, fill: "#C9D1D3", fontSize: 11, position: "insideBottomLeft" }} />
        <ReferenceLine x={reopenAt} stroke="#4B5356" label={{ value: "minting reopens", fill: "#C9D1D3", fontSize: 11, position: "insideBottomRight", offset: 8 }} />
        <Line type="stepAfter" dataKey="usd" stroke="#F4F7F7" strokeWidth={1.4} dot={false} isAnimationActive={false} />
        <ReferenceDot x={peak.t} y={peak.usd} r={4} fill="#3BE3EE" stroke="#161819"
          label={{ value: `peak $${peak.usd.toFixed(2)}`, fill: "#3BE3EE", fontSize: 12, position: "left", offset: 10 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
