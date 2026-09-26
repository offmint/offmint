import mintoff from "../../public/data/mintoff.json";

/**
 * How much of the year minting is off (FINISH C1): the arithmetic, the assumption and the sources, all from
 * web/public/data/mintoff.json (backtest/src/window.ts). No typed-in figures.
 */
export const MINTOFF = mintoff as typeof mintoff;

export function MintOffWindow({ id = "mintoff" }: { id?: string }) {
  const m = MINTOFF;
  const a = m.arithmetic;
  const n = (x: number) => x.toLocaleString("en-US");
  const holidays = m.windowsWithHolidays;
  return (
    <section id={id} className="space-y-4">
      <h2 className="text-xl font-semibold">{`Minting is off ${m.shareOfCalendarPct.toFixed(1)}% of the time`}</h2>
      <p className="max-w-[75ch] text-sm text-ink-soft">
        New stock tokens can only be created while the real market is open. Robinhood&apos;s tokenization window runs
        Monday 02:00 to Saturday 02:00 (Berlin time) and is closed on US market holidays; outside it, tokens still trade
        onchain but nobody can mint or redeem them, so nothing pulls the price back to the real share price.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="card"><div className="label">Weekends</div><div className="num text-lg">{`${a.weekends} × ${a.weekendHours} h = ${n(a.weekends * a.weekendHours)} h`}</div></div>
        <div className="card"><div className="label">US market holidays</div><div className="num text-lg">{`${a.holidays} days = ${n(a.holidayHours)} h`}</div></div>
        <div className="card"><div className="label">{`Minting off in ${m.year}`}</div><div className="num text-lg">{`${n(m.mintOffHours)} h of ${n(m.hoursInYear)} h`}</div></div>
        <div className="card"><div className="label">Share of the calendar</div><div className="num text-lg">{`${m.shareOfCalendarPct}%`}</div><div className="text-xs text-ink-faint">{`longest window ${m.longestWindowHours} h`}</div></div>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-ink-soft">{`The ${holidays.length} windows that include a US holiday`}</summary>
        <table className="data mt-2">
          <thead><tr><th>From (UTC)</th><th>To (UTC)</th><th>Hours</th><th>Why</th></tr></thead>
          <tbody>{holidays.map((w) => (
            <tr key={w.start}><td className="num">{w.start.slice(0, 16).replace("T", " ")}</td><td className="num">{w.end.slice(0, 16).replace("T", " ")}</td><td className="num">{w.hours}</td><td>{w.reason}</td></tr>
          ))}</tbody>
        </table>
      </details>
      <p className="text-xs text-ink-faint">
        {`Our assumption: ${m.assumption} Weekend windows are 47 h and 49 h on the two daylight-saving weekends, which cancel out. `}
        Sources:{" "}
        {m.sources.map((s, i) => (
          <span key={s.url}>{i > 0 && " · "}<a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.what}</a></span>
        ))}
        {". Data: web/public/data/mintoff.json."}
      </p>
    </section>
  );
}
