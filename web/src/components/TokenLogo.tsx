"use client";
/* eslint-disable @next/next/no-img-element */
import { useState } from "react";

/**
 * Robinhood's own token icon (logoUrl from /rhj/assets via /api/logo) — only ever shown next to the ticker badge,
 * because Robinhood uses the same icon for every Stock Token (docs/ASSETS.md §2). Hidden if it fails to load.
 */
export function TokenLogo({ ticker, size = 18 }: { ticker: string; size?: number }) {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return (
    <img src={`/api/logo/${encodeURIComponent(ticker)}`} alt="" width={size} height={size} onError={() => setOk(false)}
      className="inline-block shrink-0 rounded-full" style={{ width: size, height: size }} />
  );
}

/** Ticker badge (the identifier) with Robinhood's token icon beside it. */
export function Token({ ticker, size = 18, dark = false, icon = true }: { ticker: string; size?: number; dark?: boolean; icon?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {icon && <TokenLogo ticker={ticker} size={size} />}
      <span className={`rounded-[6px] px-1.5 py-0.5 text-[11px] font-semibold ${dark ? "bg-graphite text-paper-text" : "bg-matte text-paper-text"}`}>{ticker}</span>
    </span>
  );
}
