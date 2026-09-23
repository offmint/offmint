// Pure timing rules (SPEC §4) shared by paper mode and the live keeper: when may the vault arm / settle?
import type { Round } from "./chain.js";
import { roundAt } from "./chain.js";
import type { EpochSim } from "./engine.js";
import { iso } from "./clock.js";

/** When would the vault arm, and would the oracle checks pass? (SPEC §4) */
export function armPlan(sim: EpochSim, hist: Round[] | undefined) {
  const p = sim.params;
  const earliest = sim.windowStart + p.armDelay;
  if (!hist) return { time: earliest, round: undefined };
  const r = roundAt(hist, earliest);
  if (!r) return { time: earliest, round: undefined, reason: "no feed round before window" };
  const time = Math.max(earliest, r.updatedAt + p.minFrozen);
  // a new round between `earliest` and `time` would reset the frozen clock; use the round live at `time`
  const r2 = roundAt(hist, time)!;
  const recentClose = r2.updatedAt >= sim.windowStart - p.maxPreCloseAge;
  const inWindow = time < sim.windowEnd;
  sim.checks = {
    feedUpdatedAt: iso(r2.updatedAt),
    frozenOk: time - r2.updatedAt >= p.minFrozen,
    recentCloseOk: recentClose,
    preCloseAgeMin: Math.round((sim.windowStart - r2.updatedAt) / 60),
    answerPositive: r2.answer > 0n,
    inWindow,
  };
  const reason = !recentClose
    ? `recent-close check fails: last feed update ${Math.round((sim.windowStart - r2.updatedAt) / 3600 * 10) / 10}h before window start (max ${p.maxPreCloseAge / 3600}h)`
    : r2.answer <= 0n
      ? "answer <= 0"
      : !inWindow
        ? "feed kept updating through the window"
        : undefined;
  return { time, round: r2, reason };
}

/** When would the vault settle? First t >= windowEnd + settleDelay with a fresh feed round (SPEC §4). */
export function settlePlan(sim: EpochSim, hist: Round[] | undefined, now: number) {
  const p = sim.params;
  let t = sim.windowEnd + p.settleDelay;
  if (!hist) return t <= now ? { time: t, round: undefined } : undefined;
  const deadline = sim.windowEnd + p.emergencyDelay;
  while (t <= Math.min(now, deadline)) {
    const r = roundAt(hist, t);
    if (r && r.updatedAt >= sim.windowEnd && t - r.updatedAt <= p.maxFreshAge) return { time: t, round: r };
    const next = hist.find((x) => x.updatedAt > t);
    if (!next) return undefined;
    t = Math.max(t, next.updatedAt);
  }
  return undefined;
}

