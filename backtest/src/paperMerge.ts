// Weekend report auto-update (docs/FINISH.md C2): attach paper mode's live result for a mint-off window to the report.
// Paper mode (keeper/src/paper.ts) writes one file per token per weekend: <paperDir>/<Saturday>-<TICKER>.json, settled
// after Monday's reopen. These are LIVE OBSERVATIONS of that weekend (real swaps, hypothetical position), run by the
// paper engine: one band from +10% to +60% over p0, not the contract's 4-step ladder, so they are labelled as such.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface PaperRow {
  ticker: string;
  status: string; // settled | armed | skipped | waiting
  p0Usd: number | null;
  maxPremiumPct: number | null;
  vsHodlPctExFees: number | null; // lock-on-fill variant, largest paper size
  state: string | null; // OPEN | PENDING_BUYBACK
}

export const PAPER_LABEL = "live observation (paper mode: real swaps, hypothetical position, single band +10% to +60%)";

/** Every paper file for the weekend that starts on `saturday` (YYYY-MM-DD). */
export function paperRowsFor(paperDir: string, saturday: string): Map<string, PaperRow> {
  const out = new Map<string, PaperRow>();
  if (!existsSync(paperDir)) return out;
  for (const f of readdirSync(paperDir)) {
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-([A-Z0-9.]+)\.json$/);
    if (!m || m[1] !== saturday) continue;
    const d = JSON.parse(readFileSync(join(paperDir, f), "utf8"));
    const lock = d.settlement?.results?.lockOnFill;
    const r = Array.isArray(lock) && lock.length ? lock[lock.length - 1] : null;
    out.set(m[2], {
      ticker: m[2],
      status: String(d.status ?? "unknown"),
      p0Usd: d.arm?.p0Usd ?? null,
      maxPremiumPct: d.stats?.maxPremiumPct ?? null,
      vsHodlPctExFees: d.status === "settled" && r ? r.vsHodlPctExFees : null,
      state: d.status === "settled" && r ? r.state : null,
    });
  }
  return out;
}

/** Saturday (YYYY-MM-DD) of a window that starts at `startIso` (a holiday Friday window still keys on its Saturday). */
export function saturdayOf(startIso: string): string {
  const t = Date.parse(startIso);
  const d = new Date(t);
  const add = (6 - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add)).toISOString().slice(0, 10);
}

/** Summary for a window: how many tokens paper mode watched and settled, and whether the observation is complete. */
export function paperSummary(rows: Map<string, PaperRow>) {
  const all = [...rows.values()];
  const settled = all.filter((r) => r.status === "settled");
  return {
    label: PAPER_LABEL,
    tokens: all.length,
    settled: settled.length,
    complete: all.length > 0 && all.every((r) => r.status === "settled" || r.status === "skipped"),
    filled: settled.filter((r) => (r.vsHodlPctExFees ?? 0) !== 0).length,
  };
}
