import { CandleChart } from "@/components/CandleChart";
import { TokenLogo } from "@/components/TokenLogo";
import { EVIDENCE } from "@/content/landing";
import hims from "../../../public/data/backtest/hims-2026-08-28.json";
import glxy from "../../../public/data/backtest/glxy-2026-09-11.json";

const events = [
  { d: hims as any, pct: EVIDENCE.hims.peakPct, date: EVIDENCE.hims.date, p0Label: "Friday close $28.84 (NYSE)" },
  { d: glxy as any, pct: EVIDENCE.glxy.peakPct, date: EVIDENCE.glxy.date, p0Label: "Friday close $24.62 (pool)" },
];

// Max weekend premium over Friday's price, 8 weekends (1 Aug – 19 Sep 2026), from our own screen. Same linear scale.
const BARS: { tickers: string[]; label: string; note: string; pct: number; hot?: boolean }[] = [
  { tickers: ["HIMS"], label: "HIMS", note: "new listing, no Chainlink feed", pct: 317.6, hot: true },
  { tickers: ["GLXY"], label: "GLXY", note: "new listing, no Chainlink feed", pct: 186.1, hot: true },
  { tickers: ["RKLB"], label: "RKLB", note: "largest feed-backed mid-cap", pct: 35.8 },
  { tickers: ["NVDA", "TSLA", "AAPL", "SPY"], label: "Large caps", note: "NVDA, TSLA, AAPL, SPY: highest of the four", pct: 2.6 },
  { tickers: ["HIMS"], label: "HIMS on weekdays", note: "95th percentile, minting on", pct: 0.41 },
];

function Bars() {
  const max = BARS[0].pct;
  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
      <div>
        <h2 className="h-section text-[40px] md:text-[64px]">Minting off. Prices up.</h2>
        <p className="mt-4 max-w-[40ch] text-[#C9D1D3]">Largest weekend premium over Friday&apos;s price, by kind of token. Same scale.</p>
      </div>
      <ul className="space-y-5">
        {BARS.map((b) => (
          <li key={b.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 md:grid-cols-[220px_minmax(0,1fr)_110px]">
            <div>
              <div className="flex items-center gap-2 text-[15px] font-medium">
                <span className="flex -space-x-1.5">{b.tickers.map((t) => <TokenLogo key={t} ticker={t} size={22} className="ring-2 ring-matte" />)}</span>
                {b.label}
              </div>
              <div className="text-xs text-[#9AA3A6]">{b.note}</div>
            </div>
            <div className="order-3 col-span-2 h-2.5 rounded-full bg-graphite md:order-none md:col-span-1">
              <div className={`h-2.5 rounded-full ${b.hot ? "bg-glow" : "bg-[#9AA3A6]"}`} style={{ width: `max(${(b.pct / max) * 100}%, 3px)` }} />
            </div>
            <div className={`fig text-right text-[26px] font-semibold md:text-[30px] ${b.hot ? "text-glow" : ""}`}>+{b.pct}%</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** §3: the dark moment. The comparison, then two real weekend spikes from our own replays. */
export function Evidence() {
  return (
    <section id="evidence" className="bg-matte text-paper-text">
      <div className="gutter py-16">
        <Bars />
        <h3 className="h-section mt-20 text-[28px] md:text-[40px]">Two real weekends</h3>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {events.map(({ d, pct, date, p0Label }) => (
            <figure key={d.id} className="rounded-[12px] border border-graphite p-4 sm:p-5">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-center gap-2">
                  <TokenLogo ticker={d.summary.ticker} size={24} />
                  <span className="font-semibold">{d.summary.ticker}</span>
                  <span className="text-sm text-[#9AA3A6]">weekend of {date}</span>
                </div>
                <div className="text-right">
                  <div className="fig text-[32px] font-semibold leading-none text-glow md:text-[40px]">+{pct}%</div>
                  <div className="text-[11px] text-[#9AA3A6]">peak premium, weekend screen</div>
                </div>
              </div>
              <div className="mt-4">
                <CandleChart swaps={d.sim.timeline} t0={d.sim.window.start} t1={d.sim.timeline[d.sim.timeline.length - 1].t} p0={d.summary.p0Usd}
                  p0Label={p0Label} reopenAt={d.sim.window.end} bucket={1800} height={280} />
              </div>
              <figcaption className="mt-2 text-[11px] text-[#9AA3A6]">
                {d.summary.ticker}/USDG, deepest hook-free Uniswap v4 pool on Robinhood Chain mainnet, {d.sim.window.startIso.slice(0, 10)} → {d.sim.window.endIso.slice(0, 10)}. 30-min candles from every swap. Replay: backtest/.
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-8 max-w-[64ch] text-[#C9D1D3]">
          Both were new listings with no Chainlink price feed. The large feed-backed names stayed under ~4%. One MSTR weekend
          (+243%) is excluded from the bars while we check it as a likely data artifact.
        </p>
        <p className="mt-2 max-w-[64ch] text-[11px] text-[#9AA3A6]">
          Headline premiums: {EVIDENCE.source}, measured against each pool&apos;s Friday price;
          the dashed line on each chart is the reference its replay used.
        </p>
      </div>
    </section>
  );
}
