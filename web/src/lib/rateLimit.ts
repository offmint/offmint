// Per-IP rate limit for the server routes that spend the Alchemy key (/api/rpc). On Cloudflare it uses the Workers
// Rate Limiting binding RPC_LIMITER (wrangler.jsonc: 120 requests per 60 s per key, counted per Cloudflare location).
// Anywhere else (next dev, next start, tests) it falls back to an in-memory fixed window with the same numbers.
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const RPC_LIMIT = { limit: 120, periodSec: 60 };

interface Limiter { limit(opts: { key: string }): Promise<{ success: boolean }> }
const windows = new Map<string, { start: number; count: number }>();

function memoryLimit(key: string, now = Date.now()): boolean {
  const w = windows.get(key);
  if (!w || now - w.start >= RPC_LIMIT.periodSec * 1000) {
    if (windows.size > 10_000) windows.clear(); // bound memory on a long-lived Node server
    windows.set(key, { start: now, count: 1 });
    return true;
  }
  return ++w.count <= RPC_LIMIT.limit;
}

/** The caller's IP: Cloudflare's header first, then the usual proxy headers. */
export function clientIp(req: Request): string {
  const h = req.headers;
  return h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}

/** true if this request may proceed. */
export async function allow(req: Request, route: string): Promise<boolean> {
  const key = `${route}:${clientIp(req)}`;
  let binding: Limiter | undefined;
  try {
    binding = (getCloudflareContext().env as { RPC_LIMITER?: Limiter }).RPC_LIMITER;
  } catch {
    binding = undefined; // not running on Workers
  }
  return binding ? (await binding.limit({ key })).success : memoryLimit(key);
}
