// Robinhood's own token icon for a stock token (docs/ASSETS.md §2): the exact image at `logoUrl` from /rhj/assets.
// Robinhood serves the same icon for every Stock Token, so the ticker badge next to it is what identifies the token.
// Unknown tickers return 404 and the UI shows the ticker badge alone. /rhj/assets is cached server-side for 10 min.
import { NextResponse } from "next/server";

let assets: { at: number; logo: Map<string, string> } | null = null;

async function logoMap(): Promise<Map<string, string>> {
  if (assets && Date.now() - assets.at < 10 * 60_000) return assets.logo;
  const r = await fetch("https://api.robinhood.com/rhj/assets", { cache: "no-store", signal: AbortSignal.timeout(8000) });
  const logo = new Map<string, string>();
  for (const a of (await r.json()).assets ?? []) if (a.logoUrl) logo.set(String(a.tokenSymbol).toUpperCase(), String(a.logoUrl));
  assets = { at: Date.now(), logo };
  return logo;
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = (await params).ticker.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 10);
  let url: string | undefined;
  try {
    url = (await logoMap()).get(ticker);
  } catch {
    url = assets?.logo.get(ticker); // API down: keep serving the last known map
  }
  if (!url || !url.startsWith("https://cdn.robinhood.com/")) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "public, max-age=600" } });
}
