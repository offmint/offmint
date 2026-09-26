import { WEEKENDS } from "@/lib/weekends";
import { FactCarousel } from "./FactCarousel";
import { BIG_STATS, FACTS } from "./Facts";

/** Tokens that went above 10% (premium held 15 min) in any mint-off window, highest first: stands where logos would. */
const HOT = (() => {
  const best = new Map<string, number>();
  for (const w of WEEKENDS.windows)
    for (const t of w.tokens)
      if (t.active && t.peakPct !== null && t.peakPct >= 10) best.set(t.ticker, Math.max(best.get(t.ticker) ?? 0, t.peakPct));
  return [...best].sort((a, b) => b[1] - a[1]).slice(0, 8);
})();

export function TickerStrip() {
  return (
    <section id="strip" aria-label="Tokens that spiked" className="border-y border-graphite">
      <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8">
        {HOT.map(([t, p]) => (
          <li key={t} className="flex flex-col items-center justify-center gap-1 border-b border-r border-graphite py-6 lg:border-b-0">
            <span className="text-lg font-semibold tracking-wide">{t}</span>
            <span className="fig text-sm text-glow">{`+${p.toFixed(1)}%`}</span>
          </li>
        ))}
      </ul>
      <p className="gutter py-3 text-center text-xs text-[#9AA3A6]">
        Largest premium held for 15 minutes, per token, in a mint-off window since July (weekend report). Tickers, not company logos.
      </p>
    </section>
  );
}

export function Facts() {
  return (
    <section id="facts" aria-label="What the data shows" className="gutter py-20 md:py-28">
      <FactCarousel facts={FACTS} />
    </section>
  );
}

const CHIP_ICON = ["$", "◎", "◐"];

export function BigStats() {
  return (
    <section id="numbers" aria-label="Totals since July" className="gutter py-16 md:py-24">
      <div className="grid gap-10 md:grid-cols-3 md:gap-0">
        {BIG_STATS.map((s, i) => (
          <div key={s.chip} className={i ? "md:border-l md:border-dashed md:border-[#5A6366] md:pl-10" : "md:pr-10"}>
            <span className="inline-flex items-center gap-2 rounded-[6px] bg-graphite px-2 py-1 text-sm">
              <span aria-hidden className="text-glow">{CHIP_ICON[i]}</span>
              {s.chip}
            </span>
            <div className="fig mt-6 text-[52px] font-semibold leading-none md:text-[72px]">{s.value}</div>
            <p className="mt-5 max-w-[34ch] text-sm text-[#C9D1D3]">{s.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
