import { EvidenceChart } from "./EvidenceChart";
import { EVIDENCE } from "@/content/landing";
import hims from "../../../public/data/backtest/hims-2026-08-28.json";
import glxy from "../../../public/data/backtest/glxy-2026-09-11.json";

const events = [
  { d: hims as any, pct: EVIDENCE.hims.peakPct, date: EVIDENCE.hims.date, p0Label: "Friday close $28.84 (NYSE)" },
  { d: glxy as any, pct: EVIDENCE.glxy.peakPct, date: EVIDENCE.glxy.date, p0Label: "Friday close $24.62 (pool)" },
];

/** §3: the dark moment. Two real weekend spikes from our own replays. */
export function Evidence() {
  return (
    <section id="evidence" className="bg-matte text-paper-text">
      <div className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">Two real weekends. Minting off, prices up.</h2>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {events.map(({ d, pct, date, p0Label }) => (
            <figure key={d.id} className="rounded-[12px] border border-graphite p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="rounded-[6px] bg-graphite px-1.5 py-0.5 text-[11px] font-semibold">{d.summary.ticker}</span>
                  <span className="text-sm text-[#9AA3A6]">weekend of {date}</span>
                </div>
                <div className="text-right">
                  <div className="fig text-[32px] font-semibold leading-none text-glow md:text-[40px]">+{pct}%</div>
                  <div className="text-[11px] text-[#9AA3A6]">peak premium, weekend screen</div>
                </div>
              </div>
              <div className="mt-4">
                <EvidenceChart timeline={d.sim.timeline} p0={d.summary.p0Usd} p0Label={p0Label} reopenAt={d.sim.window.end} />
              </div>
              <figcaption className="mt-2 text-[11px] text-[#9AA3A6]">
                {d.summary.ticker}/USDG, deepest hook-free Uniswap v4 pool on Robinhood Chain mainnet, {d.sim.window.startIso.slice(0, 10)} → {d.sim.window.endIso.slice(0, 10)}. Replay: backtest/.
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-8 max-w-[64ch] text-[#C9D1D3]">
          Both were new listings with no Chainlink price feed. The large feed-backed names we scanned (NVDA, TSLA, AAPL, SPY)
          stayed under ~4%.
        </p>
        <p className="mt-2 max-w-[64ch] text-[11px] text-[#9AA3A6]">
          Headline premiums: {EVIDENCE.source}, measured against each pool&apos;s Friday price;
          the dashed line on each chart is the reference its replay used.
        </p>
      </div>
    </section>
  );
}
