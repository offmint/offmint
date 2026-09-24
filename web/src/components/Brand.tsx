import Link from "next/link";

/** Offmint logo (docs/BRAND.md files in /brand). `tone` = background it sits on. */
export function Logo({ tone = "light", height = 26 }: { tone?: "light" | "dark"; height?: number }) {
  return (
    <Link href="/" aria-label="Offmint home" className="inline-flex items-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/brand/offmint-logo-on-${tone}.svg`} alt="offmint" style={{ height }} />
    </Link>
  );
}

/** Ticker badge instead of company logos (docs/ASSETS.md §2): the ticker on a matte chip. */
export function TickerBadge({ ticker, tone = "dark" }: { ticker: string; tone?: "dark" | "light" }) {
  const cls = tone === "dark" ? "bg-matte text-paper-text" : "bg-graphite text-paper-text";
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ${cls}`}>{ticker}</span>;
}

/** Required footer (docs/ASSETS.md §3). */
export function Disclaimer({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`space-y-1 text-xs ${dark ? "text-[#9AA3A6]" : "text-ink-faint"}`}>
      <p>Built on Robinhood Chain (an Arbitrum Orbit chain). Testnet deployment; unaudited hackathon software.</p>
      <p>
        Offmint is an independent project and is not affiliated with or endorsed by Robinhood or the Arbitrum Foundation.
        Robinhood Stock Tokens are not available to US persons.
      </p>
      <p>The keeper is a rules-based bot (threshold checks against a price reference), not an AI.</p>
    </div>
  );
}
