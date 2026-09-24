/* eslint-disable @next/next/no-img-element */
/** Token logo by ticker (served by /api/logo/<TICKER>, which falls back to a ticker badge), plus optional label. */
export function TokenLogo({ ticker, size = 20, className = "" }: { ticker: string; size?: number; className?: string }) {
  return (
    <img src={`/api/logo/${encodeURIComponent(ticker)}`} alt="" width={size} height={size} loading="eager" decoding="async"
      className={`inline-block shrink-0 rounded-full bg-white object-contain ring-1 ring-black/10 ${className}`} style={{ width: size, height: size }} />
  );
}

/** Logo + ticker, the standard way a token is shown anywhere on the site. */
export function Token({ ticker, size = 20, dark = false, className = "" }: { ticker: string; size?: number; dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${dark ? "text-paper-text" : "text-matte"} ${className}`}>
      <TokenLogo ticker={ticker} size={size} />
      {ticker}
    </span>
  );
}
