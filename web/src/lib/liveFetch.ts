/**
 * GET /api/live, retried (after 3 s, then 6 s) while the answer has no pool prices. The server reads pools through the
 * public RPC, which sometimes refuses Cloudflare's shared IPs; a retry usually reaches a server copy that has fresh data.
 */
export async function fetchLive<T = any>(): Promise<T> {
  let d: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 3_000 * attempt));
    d = await fetch("/api/live", { cache: "no-store" }).then((r) => r.json());
    const rows: any[] = d?.rows ?? [];
    if (d?.ok && (rows.length === 0 || rows.some((r) => r.poolUsd !== null && r.poolUsd !== undefined))) break;
  }
  return d as T;
}
