import { CandleChart } from "@/components/CandleChart";
import { Token } from "@/components/TokenLogo";
import { BARS, EVENTS, SCREEN_WEEKENDS } from "@/lib/claims";

const fmt = (x: number) => `+${x < 1 ? x.toFixed(2) : x.toFixed(1)}%`;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Bars() {
  const max = Math.max(...BARS.map((b) => b.pct));
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
      <div>
        <h2 className="h-section text-[40px] md:text-[64px]">Minting off. Prices up.</h2>
        <p className="mt-4 max-w-[40ch] text-[#C9D1D3]">Largest weekend premium over the Friday reference, same scale for every bar.</p>
      </div>
      <ul className="space-y-5">
        {BARS.map((b) => (
          <li key={b.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[230px_minmax(0,1fr)_110px]">
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-[15px] font-medium">
                {b.tickers.length > 1 ? <span>{b.label}</span> : <Token ticker={b.tickers[0]} dark />}
                {b.tickers.length === 1 && b.label !== b.tickers[0] && <span>{b.label.replace(b.tickers[0], "").trim()}</span>}
              </div>
              <div className="mt-0.5 text-xs text-[#9AA3A6]">{b.note}</div>
            </div>
            <div className="order-3 col-span-2 h-2.5 rounded-full bg-graphite md:order-none md:col-span-1">
              <div className={`h-2.5 rounded-full ${b.hot ? "bg-glow" : "bg-[#9AA3A6]"}`} style={{ width: `max(${(b.pct / max) * 100}%, 3px)` }} />
            </div>
            <div className={`fig text-right text-[26px] font-semibold md:text-[30px] ${b.hot ? "text-glow" : ""}`}>{fmt(b.pct)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** §3: the dark moment. The comparison, then two real weekend spikes; one reference per chart, stated. */
export function Evidence() {
  return (
    <section id="evidence" className="bg-matte text-paper-text">
      <div className="gutter py-16">
        <Bars />
        <h3 className="h-section mt-20 text-[28px] md:text-[40px]">Two real weekends</h3>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {EVENTS.map((e) => (
            <figure key={e.ticker} className="rounded-[12px] border border-graphite p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Token ticker={e.ticker} dark />
                  <span className="text-sm text-[#9AA3A6]">weekend of {day(e.screen.weekend)} 2026</span>
                </div>
                <div className="text-right">
                  <div className="fig text-[32px] font-semibold leading-none text-glow md:text-[40px]">{fmt(e.screen.maxPremiumPct!)}</div>
                  <div className="text-[11px] text-[#9AA3A6]">peak ${e.peakUsd.toFixed(2)} over ${e.p0.toFixed(2)}</div>
                </div>
              </div>
              <div className="mt-4">
                <CandleChart swaps={e.doc.sim.timeline} t0={e.doc.sim.window.start} t1={e.doc.sim.timeline[e.doc.sim.timeline.length - 1].t}
                  p0={e.p0} p0Label={`reference $${e.p0.toFixed(2)} (pool, Fri 20:00 UTC)`} reopenAt={e.doc.sim.window.end} bucket={1800} height={280} />
              </div>
              <figcaption className="mt-2 text-[11px] text-[#9AA3A6]">
                {e.ticker}/USDG, deepest hook-free Uniswap v4 pool, Robinhood Chain mainnet, {e.doc.sim.window.startIso.slice(0, 10)} → {e.doc.sim.window.endIso.slice(0, 10)}. 30-min candles from every swap.
                {e.nyseClose !== null && ` Reference is the pool price at Fri 20:00 UTC; the NYSE close was $${e.nyseClose.toFixed(2)}.`}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-8 max-w-[64ch] text-[#C9D1D3]">
          New listings without a Chainlink feed spiked on two weekends; MSTR, which has a feed, spiked the same weekend as HIMS.
          The largest names stayed within a few percent.
        </p>
        <p className="mt-2 max-w-[64ch] text-[11px] text-[#9AA3A6]">
          Source: our weekend screen, {SCREEN_WEEKENDS.length} weekends ({SCREEN_WEEKENDS[0]} to {SCREEN_WEEKENDS.at(-1)}), every swap on each
          ticker&apos;s deepest hook-free pool. Reference: the Chainlink close where a feed exists, otherwise the pool price at Fri 20:00 UTC.
        </p>
      </div>
    </section>
  );
}
