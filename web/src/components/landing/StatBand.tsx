"use client";
import { useEffect, useState } from "react";
import { LARGEST, EVENTS } from "@/lib/claims";
import { GATE } from "@/lib/liveGate";
import { Token } from "@/components/TokenLogo";

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

interface Live { basket: { live: boolean; count: number | null }; maxVerified: { ticker: string; pct: number } | null; verifiedCount: number; updatedAt: string }

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
  const prem = L ? (L.maxVerified ? `${L.maxVerified.pct >= 0 ? "+" : ""}${L.maxVerified.pct.toFixed(1)}%` : "None") : null;
  const stats = [
    { logo: undefined as string | undefined, value: s ? dur(s.next - now!) : null, label: s?.off ? "Minting off · reopens in" : "until minting turns off", src: "Weekend window Sat 00:00 → Mon 00:00 UTC (SessionClock)" },
    { value: `+${LARGEST.toFixed(1)}%`, label: "largest weekend premium in our screen", src: `Weekend screen, every swap (HIMS, ${EVENTS[0].screen.weekend}); simulated vault numbers are separate`, logo: "HIMS" },
    { logo: undefined, value: count, label: "new listings in the vulnerable window now", src: `Live: detector basket (no Chainlink feed, pool ≤ 30 days, ≥ $${GATE.minTvlUsd.toLocaleString("en-US")} liquidity)` },
    { value: prem, label: L?.maxVerified ? "highest verified live premium" : "verified live premiums right now", src: "Live: pool price vs Robinhood's quote, passing every quality check (TVL, depth, fresh swaps, tight quote, GeckoTerminal agrees)", logo: L?.maxVerified?.ticker },
  ];
  return (
    <section id="stats" className="gutter pb-12">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((x, i) => (
          <div key={i} title={`Source: ${x.src}`} className="rounded-[12px] border border-paper-line bg-paper-card p-5">
            <div className="text-sm text-ink-soft">{x.value ? x.label : `${x.label} (updating)`}</div>
            <div className="fig mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[34px] font-semibold leading-none md:text-[40px]">
              {x.value ?? <span className="text-ink-faint">—</span>}
              {x.logo && x.value && x.value !== "None" && <Token ticker={x.logo} />}
            </div>
            <div className="mt-2 text-[11px] text-ink-faint">{x.src}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
