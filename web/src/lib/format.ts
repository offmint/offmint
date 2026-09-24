export const usd = (x: number, d = 2) => x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const pct = (x: number, d = 2) => `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const fromUnits = (v: bigint, dec: number) => Number(v) / 10 ** dec;
export const utc = (t: number) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";

/** Next Saturday 00:00 UTC (when stock-token minting closes for the weekend). */
export function nextSaturday(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  const day = d.getUTCDay();
  const add = (6 - day + 7) % 7 || 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add) / 1000;
}
