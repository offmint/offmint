"use client";
import { useEffect, useState } from "react";
import { TickerBadge } from "@/components/Brand";
import { fetchLive } from "@/lib/liveFetch";

interface Live { basket: { live: boolean; count: number | null }; rows?: { ticker?: string }[] }

/** Hero pill: how many new listings are in the vulnerable window right now (detector basket, via /api/live). */
export function LiveBadge() {
  const [live, setLive] = useState<Live | null | "error">(null);
  useEffect(() => {
    fetchLive<Live>().then(setLive).catch(() => setLive("error"));
  }, []);
  const L = live && live !== "error" && live.basket.live ? live.basket : null;
  const tickers = live && live !== "error" ? (live.rows ?? []).map((r) => r.ticker).filter((t): t is string => !!t).slice(0, 3) : [];
  return (
    <a href="#live" className="inline-flex items-center gap-2 rounded-full border border-paper-line bg-paper-card py-1 pl-1 pr-3 text-sm text-ink-soft hover:text-ink">
      <span className="flex gap-1">
        {tickers.map((t) => <TickerBadge key={t} ticker={t} />)}
      </span>
      {L && L.count !== null ? (
        <span><span className="fig font-semibold text-ink">{L.count}</span> new listings in the vulnerable window now</span>
      ) : (
        <span>Live monitor {live === null ? "loading" : "updating"}</span>
      )}
    </a>
  );
}
