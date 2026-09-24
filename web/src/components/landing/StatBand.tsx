"use client";
import { useEffect, useState } from "react";
import { EVIDENCE } from "@/content/landing";
import { TokenLogo } from "@/components/TokenLogo";

/** Weekend window (SessionClock): Sat 00:00 -> Mon 00:00 UTC. Returns whether minting is off and the next flip. */
export function sessionNow(ms: number) {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 Sun .. 6 Sat
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const off = day === 6 || day === 0;
  const next = off ? midnight + ((day === 6 ? 2 : 1) * 86_400_000) : midnight + ((6 - day) * 86_400_000);
  return { off, next };
}

function dur(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m`;
}

interface Live { basket: { live: boolean; count: number | null }; maxPremium: { ticker: string; pct: number } | null; updatedAt: string }

export function StatBand() {
  const [now, setNow] = useState<number | null>(null);
  const [live, setLive] = useState<Live | null | "error">(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const load = () => fetch("/api/live").then((r) => r.json()).then(setLive).catch(() => setLive("error"));
    load();
    const u = setInterval(load, 60_000);
    return () => { clearInterval(t); clearInterval(u); };
  }, []);
  const s = now ? sessionNow(now) : null;
  const L = live && live !== "error" ? live : null;
  const count = L?.basket.live ? String(L.basket.count) : null;
  const prem = L?.maxPremium ? `${L.maxPremium.pct >= 0 ? "+" : ""}${L.maxPremium.pct.toFixed(1)}%` : null;
  const stats = [
    { logo: undefined as string | undefined, value: s ? dur(s.next - now!) : null, label: s?.off ? "Minting off · reopens in" : "until minting turns off", src: "Weekend window Sat 00:00 → Mon 00:00 UTC (SessionClock)" },
    { value: `+${EVIDENCE.hims.peakPct}%`, label: `largest weekend premium observed (HIMS, ${EVIDENCE.hims.date.slice(0, 6)})`, src: "Our backtest, Uniswap v4 swap logs", logo: "HIMS" },
    { logo: undefined, value: count, label: "new listings in the vulnerable window now", src: "Detector basket: no Chainlink feed, pool ≤ 30 days, ≥ $10k liquidity" },
    { value: prem, label: L?.maxPremium ? `highest live premium right now (${L.maxPremium.ticker})` : "highest live premium right now", src: "Onchain pool price vs Robinhood's reference price, refreshed every 60 s", logo: L?.maxPremium?.ticker },
  ];
  return (
    <section id="stats" className="gutter pb-16">
      <div className="grid grid-cols-2 border-t border-paper-line md:grid-cols-4">
        {stats.map((x, i) => (
          <div key={i} title={`Source: ${x.src}`} className={`py-6 pr-4 ${i % 2 ? "pl-4 md:pl-6" : "md:pl-6"} ${i ? "md:border-l md:border-paper-line" : "md:pl-0"} ${i % 2 ? "border-l border-paper-line md:border-l" : ""}`}>
            <div className="text-sm text-ink-soft">{x.value ? x.label : `${x.label} (updating)`}</div>
            <div className="fig mt-2 flex items-center gap-3 whitespace-nowrap text-[34px] font-semibold leading-none md:text-[52px]">
              {x.value ?? <span className="text-ink-faint">—</span>}
              {x.logo && x.value && <TokenLogo ticker={x.logo} size={30} />}
            </div>
            <div className="mt-2 text-[11px] text-ink-faint">{x.src}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
