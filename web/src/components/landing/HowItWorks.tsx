"use client";
import { useState } from "react";
import { WORKED as G, LADDER, PARAMS, FORK } from "@/lib/claims";
const FORK_SOURCE = FORK.source as string;
import { Token } from "@/components/TokenLogo";

const PREMIUMS = LADDER.map(([lo]) => lo);

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
  const placed = Math.round(G.placed.reduce((a: number, b: number) => a + b, 0) * 100) / 100;
  const cards = [
    { n: "01", title: "Friday close", big: `${G.held} GLXY`, sub: `held · Friday price $${G.p0.toFixed(2)}` },
    {
      n: "02", title: "Sell ladder posted", big: `${placed} GLXY`, sub: "placed in 4 steps above Friday's price",
      steps: G.placed.map((q: number, i: number) => ({ q, p: PREMIUMS[i], filled: spike })),
    },
    spike
      ? { n: "03", title: "Weekend spike fills all 4", big: `$${G.usdgReceived.toFixed(2)}`, sub: "collected in USDG, each step sold above its floor" }
      : { n: "03", title: "No spike", big: `$${(0).toFixed(2)}`, sub: "no step reached; nothing sold" },
    spike
      ? { n: "04", title: "Monday buyback, capped", big: `${G.holderAfter.toFixed(2)} GLXY`, sub: `bought back ${G.stockBought.toFixed(2)} at ≤ fresh price + ${PARAMS.vault.buybackSlippageBps / 100}%, after the ${G.feeStock.toFixed(2)} GLXY fee` }
      : { n: "04", title: "Monday", big: `${G.held.toFixed(2)} GLXY`, sub: "ladder pulled back unsold: nothing lost on the ladder" },
  ];
  return (
    <section id="how" className="gutter py-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="h-section text-[40px] md:text-[64px]">How it works, with real numbers</h2>
          <p className="mt-2 flex max-w-[64ch] flex-wrap items-center gap-2 text-ink-soft">Simulated weekend on the real <Token ticker="GLXY" /> pool, mainnet fork @ block {G.block.toLocaleString("en-US")}.</p>
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
              <div className={`fig mt-3 flex items-center gap-2 text-[30px] font-semibold leading-none ${i === 3 && spike ? "text-tide" : ""}`}>
                {c.big}
              </div>
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
        Simulated: {FORK_SOURCE}, block {G.block}. {spike ? `Per step: ${G.usdg.map((u: number) => `$${u.toFixed(2)}`).join(" / ")}.` : "No-spike view: the ladder is one-sided, so unfilled steps return the same GLXY."} Real fills would be lower: our own orders shrink the spike they sell into.
      </p>
    </section>
  );
}
