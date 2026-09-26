"use client";
import { useState } from "react";
import { TickerBadge } from "@/components/Brand";
import type { Fact } from "./Facts";

/** One big statement at a time with its source, prev/next arrows and a 01/05 counter. No autoplay. */
export function FactCarousel({ facts }: { facts: Fact[] }) {
  const [i, setI] = useState(0);
  const f = facts[i];
  const n = facts.length;
  const pad = (x: number) => String(x).padStart(2, "0");
  const btn = "flex h-11 w-16 items-center justify-center rounded-full border border-graphite text-paper-text transition hover:border-glow focus-visible:outline focus-visible:outline-2 focus-visible:outline-glow";
  return (
    <div className="mx-auto max-w-5xl">
      <div className="grid gap-6 md:grid-cols-[88px_1fr]">
        <div aria-hidden className="h-display text-[88px] leading-[0.7] text-glow md:text-[120px]">&ldquo;</div>
        <div>
          <p aria-live="polite" className="h-section min-h-[6.5em] text-[26px] md:min-h-[4.5em] md:text-[40px]">{f.text}</p>
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-graphite">
                {f.ticker ? <TickerBadge ticker={f.ticker} tone="light" /> : <span className="h-2.5 w-2.5 rounded-full bg-glow" />}
              </span>
              <div>
                <div className="font-medium">{f.label}</div>
                <div className="text-xs text-[#9AA3A6]">{f.source}</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button type="button" aria-label="Previous fact" className={btn} onClick={() => setI((i + n - 1) % n)}>←</button>
              <span className="fig text-sm"><span className="font-semibold">{pad(i + 1)}</span><span className="text-[#9AA3A6]">/{pad(n)}</span></span>
              <button type="button" aria-label="Next fact" className={`${btn} bg-graphite`} onClick={() => setI((i + 1) % n)}>→</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
