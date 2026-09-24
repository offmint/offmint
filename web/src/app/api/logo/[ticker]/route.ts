// Token logos by ticker, so a newly listed stock token gets a logo with no manual step.
// Robinhood's own logoUrl is the same Robinhood feather for every token, so company logos come from public
// ticker-keyed sources: Parqet (round brand icons, SVG), then Financial Modeling Prep (covers new listings, PNG),
// then a generated ticker badge (always renders). Cached in memory for 24 h and by the browser/CDN.
import { NextResponse } from "next/server";

const DAY = 86_400;
const cache = new Map<string, { at: number; body: ArrayBuffer | string; type: string; fallback?: boolean }>();

function badge(ticker: string) {
  const t = ticker.slice(0, 5);
  const size = t.length <= 3 ? 26 : t.length === 4 ? 21 : 17;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#161819"/><text x="32" y="${32 + size * 0.36}" text-anchor="middle" font-family="Schibsted Grotesk, ui-sans-serif, system-ui, sans-serif" font-weight="700" font-size="${size}" fill="#F4F7F7">${t}</text></svg>`;
}

async function tryFetch(url: string, types: RegExp) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "user-agent": "offmint-web/0.1" } });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !types.test(type)) return null;
    const body = await r.arrayBuffer();
    return body.byteLength > 200 ? { body, type } : null;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const ticker = (await params).ticker.toUpperCase().replace(/[^A-Z0-9.]/g, "").slice(0, 10);
  const hit = cache.get(ticker);
  if (!hit || Date.now() - hit.at > DAY * 1000) {
    const parqet = await tryFetch(`https://assets.parqet.com/logos/symbol/${ticker}?format=svg`, /svg/);
    if (parqet) cache.set(ticker, { at: Date.now(), ...parqet });
    else {
      // FMP logos are often white on transparent: wrap them in a round Matte chip so they read on any background.
      // Fallbacks are only cached for 10 min, so a transient Parqet failure recovers on its own.
      const fmp = await tryFetch(`https://financialmodelingprep.com/image-stock/${ticker}.png`, /image\//);
      const body = fmp
        ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="#161819"/><image href="data:${fmp.type};base64,${Buffer.from(fmp.body as ArrayBuffer).toString("base64")}" x="12" y="12" width="40" height="40" preserveAspectRatio="xMidYMid meet"/></svg>`
        : badge(ticker);
      cache.set(ticker, { at: Date.now() - DAY * 1000 + 600_000, body, type: "image/svg+xml", fallback: true });
    }
  }
  const e = cache.get(ticker)!;
  return new NextResponse(e.body as any, {
    headers: { "content-type": e.type, "cache-control": e.fallback ? "public, max-age=600" : `public, max-age=${DAY}, stale-while-revalidate=${7 * DAY}` },
  });
}
