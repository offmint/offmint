"use client";
import { useState } from "react";
import { WORKED_GLXY as G } from "@/content/landing";

const PREMIUMS = [8, 15, 25, 40];

/** Mini staircase used as the connector between cards (the logo's ladder motif). */
function Stairs({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 24" className={className} aria-hidden>
      <path d="M2 22 H12 V16 H22 V10 H32 V4 H38" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function HowItWorks() {
  const [spike, setSpike] = useState(true);
  const placed = G.placed.reduce((a, b) => a + b, 0);
  const cards = [
    { n: "01", title: "Friday close", big: `${G.held} GLXY`, sub: `held · Friday price $${G.p0.toFixed(2)}` },
    {
      n: "02", title: "Sell ladder posted", big: `${placed} GLXY`, sub: "placed in 4 steps above Friday's price",
      steps: G.placed.map((q, i) => ({ q, p: PREMIUMS[i], filled: spike })),
    },
    spike
      ? { n: "03", title: "Weekend spike fills all 4", big: `$${G.collected.toFixed(2)}`, sub: "collected in USDG, each step sold above its floor" }
      : { n: "03", title: "No spike", big: "$0.00", sub: "no step reached; nothing sold" },
    spike
      ? { n: "04", title: "Monday buyback, capped", big: `${G.after.toFixed(2)} GLXY`, sub: `bought back ${G.boughtBack.toFixed(2)} at ≤ fresh price + 1%, after the ${G.fee.toFixed(2)} GLXY fee` }
      : { n: "04", title: "Monday", big: `${G.held.toFixed(2)} GLXY`, sub: "ladder pulled back unsold: nothing lost on the ladder" },
  ];
  return (
    <section id="how" className="mx-auto max-w-6xl px-4 py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">How it works, with real numbers</h2>
          <p className="mt-2 max-w-[64ch] text-ink-soft">One weekend on the real GLXY pool.</p>
        </div>
        <div role="tablist" aria-label="Scenario" className="inline-flex rounded-[6px] border border-paper-line bg-paper-card p-1 text-sm">
          {[["Spike", true], ["No spike", false]].map(([label, v]) => (
            <button key={String(label)} role="tab" aria-selected={spike === v} onClick={() => setSpike(v as boolean)}
              className={`rounded-[6px] px-3 py-1.5 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-tide ${spike === v ? "bg-matte text-paper-text" : "text-ink-soft hover:text-matte"}`}>
              {label as string}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-3 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] md:items-stretch">
        {cards.map((c, i) => (
          <div key={c.n} className="contents">
            <div className="rounded-[12px] border border-paper-line bg-paper-card p-5">
              <div className="text-xs text-ink-faint num">{c.n}</div>
              <div className="mt-1 text-sm font-medium">{c.title}</div>
              <div className={`fig mt-3 text-[30px] font-semibold leading-none ${i === 3 && spike ? "text-tide" : ""}`}>{c.big}</div>
              <div className="mt-2 text-sm text-ink-soft">{c.sub}</div>
              {"steps" in c && c.steps && (
                <div className="mt-4 space-y-1">
                  {[...c.steps].reverse().map((s) => (
                    <div key={s.p} className="flex items-center gap-2 text-xs">
                      <span className="w-10 text-ink-faint num">+{s.p}%</span>
                      <span className={`h-2 rounded-[2px] ${spike ? "bg-tide" : "border border-ink-faint"}`} style={{ width: `${s.q * 9}px` }} />
                      <span className="num text-ink-soft">{s.q.toFixed(1)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {i < cards.length - 1 && (
              <div className="flex items-center justify-center text-ink-faint md:px-1">
                <Stairs className="h-5 w-8 rotate-90 md:rotate-0" />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-ink-faint">
        {G.source}; simulated +70% spike, Monday reopen +1%. {spike ? `Per step: ${G.usdg.map((u) => `$${u.toFixed(2)}`).join(" / ")}.` : "No-spike view: the ladder is one-sided, so unfilled steps return the same GLXY."}
      </p>
    </section>
  );
}
