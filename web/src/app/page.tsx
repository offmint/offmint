"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PriceChart } from "@/components/PriceChart";
import { RiskDisclosure, JurisdictionNotice } from "@/components/Risk";
import { EVENTS, loadBacktest, type BacktestDoc } from "@/lib/backtest";

export default function Home() {
  const [docs, setDocs] = useState<BacktestDoc[]>([]);
  useEffect(() => {
    Promise.all(EVENTS.map(loadBacktest)).then(setDocs).catch(() => {});
  }, []);
  return (
    <div className="space-y-10">
      <section className="pt-6">
        <h1 className="text-4xl font-semibold tracking-tight">They price the weekend. We supply it.</h1>
        <p className="mt-4 max-w-3xl text-lg text-ink-soft">
          Deposit USDG. Each week MetaVault may rotate part of it into the newly listed Robinhood stock tokens most
          exposed to a weekend supply crunch, sells into any squeeze above the Friday close while minting is frozen,
          buys back Monday, and converts to USDG. When it works, you get more USDG back. When no squeeze comes, it is
          an ordinary stock position sold Monday.
        </p>
        <div className="mt-6 flex gap-3">
          <Link href="/app" className="btn-primary">Open the app</Link>
          <Link href="/monitor" className="btn-ghost">Live monitor</Link>
        </div>
      </section>

      <RiskDisclosure />

      <section>
        <h2 className="mb-1 text-xl font-semibold">Two real weekends, two different tickers</h2>
        <p className="mb-4 text-sm text-ink-soft">
          Across the no-Chainlink-feed listings, squeezes happened twice in four weekends, on different tickers
          (majors never did). That is why MetaVault rotates across a live basket instead of a fixed list.
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {docs.map((d) => (
            <div key={d.id} className="card">
              <div className="flex items-baseline justify-between">
                <div className="font-medium">{d.summary.ticker}: {d.event.title ?? d.id}</div>
                <div className="num text-sm text-gain">peak ${d.summary.maxPoolUsd.toFixed(2)}</div>
              </div>
              <div className="mb-2 text-xs text-ink-faint">Friday close ${d.summary.p0Usd.toFixed(2)} · sell band ${d.summary.bandUsd[0].toFixed(2)}–${d.summary.bandUsd[1].toFixed(2)}</div>
              <PriceChart data={d.sim.timeline} p0={d.summary.p0Usd} band={d.summary.bandUsd} height={220} />
              <div className="mt-2 text-sm">{d.summary.headline}</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-faint">Hypothetical replays on real Uniswap v4 swaps. A live vault would dampen the spike, so real fills would differ. <Link href="/backtest" className="underline">Details</Link></p>
      </section>
      <JurisdictionNotice />
    </div>
  );
}
