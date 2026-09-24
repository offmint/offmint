"use client";
import { useEffect, useState } from "react";
import { PAPER_API } from "@/lib/config";
import { Countdown } from "@/components/Countdown";
import { usd } from "@/lib/format";
import { Token } from "@/components/TokenLogo";

interface Member { ticker: string; token: string; hasFeed: boolean; poolAgeDays: number; tvlUsd: number; depthUsdTo10: number; priceUsd: number | null; path: string }
interface Basket { generatedAt: string; rule?: string; counts: Record<string, number>; members: Member[]; excluded: { ticker: string; reason: string }[] }
interface LiveRow { token: string; poolUsd: number | null; refUsd: number | null; premiumPct: number | null; verified: boolean; reasons: string[]; lastSwapAgeSec: number | null }
interface Health { lastTickAgoSec: number | null; lastTick?: { status?: Record<string, string> }; detector?: { lastRunAt: number; members: number } }

/** Live, no wallet: the detector's basket (SPEC §3.7) and the paper keeper's per-ticker state, from the Railway service. */
export default function Monitor() {
  const [basket, setBasket] = useState<Basket | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<Map<string, LiveRow>>(new Map());
  useEffect(() => {
    const load = () =>
      Promise.all([fetch(`${PAPER_API}/basket.json`).then((r) => r.json()), fetch(`${PAPER_API}/health`).then((r) => r.json())])
        .then(([b, h]) => { setBasket(b); setHealth(h); setErr(null); })
        .catch((e) => setErr(String(e)));
    const loadLive = () => fetch("/api/live").then((r) => r.json()).then((d) => setLive(new Map((d.rows as LiveRow[]).map((r) => [r.token, r])))).catch(() => {});
    load();
    loadLive();
    const t = setInterval(() => { load(); loadLive(); }, 60_000);
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
          <thead><tr><th>Ticker</th><th>Price reference</th><th>Pool price</th><th>Reference</th><th>Premium</th><th>Quality</th><th>Pool age</th><th>TVL</th><th>$ to move +10%</th><th>Paper keeper</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.token}>
                <td><Token ticker={m.ticker} size={22} /></td>
                <td className="text-xs">{m.hasFeed ? "Chainlink" : "none (PushPriceReference path)"}</td>
                <td className="num">{live.get(m.token)?.poolUsd ? `$${live.get(m.token)!.poolUsd!.toFixed(2)}` : "–"}</td>
                <td className="num text-ink-soft">{live.get(m.token)?.refUsd ? `$${live.get(m.token)!.refUsd!.toFixed(2)}` : "–"}</td>
                <td className="num">{live.get(m.token)?.premiumPct != null ? `${live.get(m.token)!.premiumPct! >= 0 ? "+" : ""}${live.get(m.token)!.premiumPct!.toFixed(2)}%` : "–"}</td>
                <td className="text-xs">{!live.get(m.token) ? "–" : live.get(m.token)!.verified ? <span className="text-tide">verified</span> : <span className="text-caution" title={live.get(m.token)!.reasons.join("; ")}>unverified: {live.get(m.token)!.reasons[0]}</span>}</td>
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
