"use client";
import { useEffect, useRef, useState } from "react";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Mon -> Sun, minting window light, Sat 00:00 -> Mon 00:00 UTC Matte ("Minting off"), a live "now" marker. */
export function WeekStrip() {
  const [now, setNow] = useState<Date | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setNow(new Date());
    // narrow screens: scroll so "now" sits near the left edge and as much of the weekend as fits is visible
    const el = scroller.current;
    if (el && el.scrollWidth > el.clientWidth) {
      const d = new Date();
      const f = (((d.getUTCDay() + 6) % 7) * 86400 + d.getUTCHours() * 3600) / (7 * 86400);
      el.scrollLeft = Math.min(el.scrollWidth - el.clientWidth, Math.max(0, f * el.scrollWidth - 70));
    }
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  // position of "now" in the UTC week (Mon 00:00 = 0, next Mon 00:00 = 1)
  const frac = now ? (((now.getUTCDay() + 6) % 7) * 86400 + now.getUTCHours() * 3600 + now.getUTCMinutes() * 60) / (7 * 86400) : null;
  const local = now?.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
  const utc = now ? `${DAYS[(now.getUTCDay() + 6) % 7]} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")} UTC` : "";
  return (
    <section id="week" className="gutter py-14">
      <h2 className="h-section text-[32px] md:text-[48px]">The week, as the market sees it</h2>
      <p className="mt-2 max-w-[64ch] text-ink-soft">Stock tokens trade 24/7. New ones can only be created while the real market is open.</p>
      <div ref={scroller} className="mt-4 overflow-x-auto pb-2 pt-8">
        <div className="relative min-w-[720px]">
          <div className="grid grid-cols-7 overflow-hidden rounded-[12px] border border-paper-line">
            {DAYS.map((d, i) => {
              const off = i >= 5;
              return (
                <div key={d} className={`h-24 border-r p-3 last:border-r-0 ${off ? "border-graphite bg-matte text-paper-text" : "border-paper-line bg-paper-card"}`}>
                  <div className={`text-sm font-medium ${off ? "text-paper-text" : "text-matte"}`}>{d}</div>
                  <div className={`mt-1 text-xs ${off ? "text-[#9AA3A6]" : "text-ink-faint"}`}>{off ? "Minting off" : "Minting on"}</div>
                </div>
              );
            })}
          </div>
          <div className="pointer-events-none absolute inset-y-0 left-[71.43%] right-0 hidden items-end justify-center pb-3 text-xs text-glow md:flex">
            Sat 00:00 → Mon 00:00 UTC · supply can&apos;t respond
          </div>
          {frac !== null && (
            <div className="pointer-events-none absolute -bottom-1 -top-1 w-0" style={{ left: `${frac * 100}%` }}>
              <div className={`absolute inset-y-0 w-[2px] -translate-x-1/2 ${frac >= 5 / 7 ? "bg-glow" : "bg-tide"}`} />
              <div className={`absolute -top-7 -translate-x-1/2 whitespace-nowrap rounded-[6px] px-2 py-0.5 text-[11px] font-medium num ${frac >= 5 / 7 ? "bg-glow text-matte" : "bg-tide text-white"}`}>
                now · {local}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 text-xs text-ink-faint">
        <span className="font-medium text-matte md:hidden">Sat 00:00 → Mon 00:00 UTC: supply can&apos;t respond. </span>
        {utc && `Now: ${utc}. Robinhood's tokenization window: Mon 02:00 → Sat 02:00 CET/CEST.`}
      </div>
    </section>
  );
}
