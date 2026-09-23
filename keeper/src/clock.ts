// Mirror of contracts/src/clock/SessionClock.sol (seconds, UTC).
const DAY = 86_400;

export const dow = (t: number) => (Math.floor(t / DAY) + 4) % 7; // 0 = Sun ... 6 = Sat

export function windowStart(ts: number, offset = 0): number {
  const t = ts - offset;
  const dayStart = t - (t % DAY);
  return dayStart - ((dow(t) + 1) % 7) * DAY + offset;
}

export const windowEnd = (ts: number, offset = 0) => windowStart(ts, offset) + 2 * DAY;

export function inWeekendWindow(ts: number, offset = 0): boolean {
  const d = dow(ts - offset);
  return d === 6 || d === 0;
}

export const isoDate = (ts: number) => new Date(ts * 1000).toISOString().slice(0, 10);
export const iso = (ts: number) => new Date(ts * 1000).toISOString().replace(".000Z", "Z");
