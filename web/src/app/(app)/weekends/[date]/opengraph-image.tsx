import { ImageResponse } from "next/og";
import { WEEKENDS, windowOf, windowDates, money } from "@/lib/weekends";

// Share card per mint-off window (docs/FEATURES.md Feature 2). Numbers only from weekends.json.
export const alt = "Offmint weekend report";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return WEEKENDS.windows.map((w) => ({ date: w.window }));
}

export default async function Card({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params;
  const w = windowOf(date);
  const th = WEEKENDS.headlineThresholdPct;
  const line = w
    ? `${w.tokensAbove10} token${w.tokensAbove10 === 1 ? "" : "s"} above 10% for an hour or more. Buyers paid ${money(w.paidAboveReferenceUsd)} above the real price on ${money(w.buysValueUsd)} of buys priced more than ${th}% over it (${w.wallets.toLocaleString("en-US")} wallets).`
    : "Weekend report";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#F4F7F7", color: "#161819", fontFamily: "sans-serif" }}>
        <div style={{ fontSize: 30, color: "#0E9F9A", fontWeight: 700 }}>offmint · weekend report</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 76, fontWeight: 700 }}>{w ? windowDates(w) : date}</div>
          <div style={{ fontSize: 40, lineHeight: 1.3 }}>{line}</div>
          {w?.biggest && <div style={{ fontSize: 32, color: "#4A5255" }}>{`Biggest: ${w.biggest.ticker} ${w.biggest.peakPct >= 0 ? "+" : ""}${w.biggest.peakPct.toFixed(1)}% over the reference close, held 15 min`}</div>}
        </div>
        <div style={{ fontSize: 24, color: "#6B7478" }}>Observed onchain, Robinhood Chain mainnet. Minting is off on weekends and US holidays.</div>
      </div>
    ),
    size,
  );
}
