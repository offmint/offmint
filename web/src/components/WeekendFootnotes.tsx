import { WEEKENDS } from "@/lib/weekends";
import { weekendOf } from "@/lib/claims";

/** Shared footnotes for the weekend report pages: definitions, exclusions, method, source. */
export function Footnotes() {
  const ex = WEEKENDS.excluded;
  return (
    <div className="max-w-[120ch] space-y-2 text-xs text-ink-faint">
      <p>
        Observed onchain, Robinhood Chain mainnet. Tokens above 10% = traded at least 10% over the reference for an hour or
        more in total. Premiums are the highest level the price held for 15 minutes; the single highest trade can be far
        higher (HIMS touched {`+${weekendOf("HIMS", "2026-08-29").maxPremiumPct!.toFixed(1)}%`} on 29 Aug, see the home page). Wallets = distinct transaction senders,
        bots and aggregators included.
      </p>
      <p>
        Excluded: {ex.tickersWithoutReference.length ? `${ex.tickersWithoutReference.join(", ")} (no official close found for the ticker); ` : ""}
        {ex.hookedPoolsNotScanned.toLocaleString("en-US")} pools with hooks (their accounting can differ from the swap event);
        {" "}{ex.offReferencePoolWindows.toLocaleString("en-US")} pool-windows whose price was more than 10% from the reference before the window (spam or mispriced pools).
      </p>
      <details>
        <summary className="cursor-pointer">Method</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">{WEEKENDS.method.map((m) => <li key={m}>{m}</li>)}</ul>
      </details>
      <p>Source: web/public/data/weekends.json (backtest/src/weekends.ts), generated {WEEKENDS.generatedAt.slice(0, 10)}.</p>
    </div>
  );
}
