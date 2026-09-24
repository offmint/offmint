"use client";
import { useEffect, useState } from "react";
import { PAPER_API } from "@/lib/config";
import { Countdown } from "@/components/Countdown";
import { usd } from "@/lib/format";

interface Member { ticker: string; token: string; hasFeed: boolean; poolAgeDays: number; tvlUsd: number; depthUsdTo10: number; priceUsd: number | null; path: string }
interface Basket { generatedAt: string; rule?: string; counts: Record<string, number>; members: Member[]; excluded: { ticker: string; reason: string }[] }
interface Health { lastTickAgoSec: number | null; lastTick?: { status?: Record<string, string> }; detector?: { lastRunAt: number; members: number } }

/** Live, no wallet: the detector's basket (SPEC §3.7) and the paper keeper's per-ticker state, from the Railway service. */
export default function Monitor() {
  const [basket, setBasket] = useState<Basket | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const load = () =>
      Promise.all([fetch(`${PAPER_API}/basket.json`).then((r) => r.json()), fetch(`${PAPER_API}/health`).then((r) => r.json())])
        .then(([b, h]) => { setBasket(b); setHealth(h); setErr(null); })
        .catch((e) => setErr(String(e)));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const status = health?.lastTick?.status ?? {};
  const members = [...(basket?.members ?? [])].sort((a, b) => a.poolAgeDays - b.poolAgeDays);
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Monitor</h1>
          <p className="text-sm text-ink-soft">Every basket member the detector found on Robinhood Chain mainnet: newly listed (pool ≤ 30 days), no Chainlink feed, at least $10k of pool liquidity. Read-only, refreshed every 30 s.</p>
        </div>
        <div className="text-right text-sm"><div className="label">Weekend window opens in</div><Countdown /></div>
      </div>
      {err && <div className="text-sm text-loss">Paper service unreachable: {err}</div>}
      <div className="grid gap-4 md:grid-cols-4">
        <div className="card"><div className="label">Basket members</div><div className="num text-xl">{basket?.members.length ?? "…"}</div></div>
        <div className="card"><div className="label">Excluded (with reasons)</div><div className="num text-xl">{basket?.excluded.length ?? "…"}</div></div>
        <div className="card"><div className="label">Detector last run</div><div className="num text-sm">{health?.detector?.lastRunAt ? new Date(health.detector.lastRunAt).toISOString().slice(0, 16) + " UTC" : "…"}</div></div>
        <div className="card"><div className="label">Paper keeper last tick</div><div className="num text-xl">{health?.lastTickAgoSec != null ? `${health.lastTickAgoSec}s ago` : "…"}</div></div>
      </div>
      <div className="card overflow-x-auto">
        <table className="data">
          <thead><tr><th>Ticker</th><th>Price reference</th><th>Pool price</th><th>Pool age</th><th>TVL</th><th>$ to move +10%</th><th>Paper keeper</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.token}>
                <td className="font-medium">{m.ticker}</td>
                <td className="text-xs">{m.hasFeed ? "Chainlink" : "none (PushPriceReference path)"}</td>
                <td className="num">{m.priceUsd ? `$${m.priceUsd.toFixed(2)}` : "–"}</td>
                <td className="num">{m.poolAgeDays.toFixed(1)}d</td>
                <td className="num">${usd(m.tvlUsd, 0)}</td>
                <td className="num">${usd(m.depthUsdTo10, 0)}</td>
                <td className="text-xs">{status[m.ticker] ?? "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-ink-faint">No PushPriceReference is deployed on mainnet yet, so the weekend premium is measured against the pool price at the Friday close (paper mode). Mainnet deployment needs explicit approval.</p>
      </div>
    </div>
  );
}
