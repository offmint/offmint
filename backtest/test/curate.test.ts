import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, saturdays, RULES, type WeekendEvidence } from "../src/curate.js";

const w = (maxPremiumPct: number | null, swaps = 50): WeekendEvidence => ({
  weekend: "2026-08-29", p0: 30, p0Source: "chainlink", swaps, maxPremiumPct, hoursAbove10: 0,
  premiumAtReopenPct: 0, depthUsdTo10pct: 1000, vaultVsHodlPctExFees: 0, specVsHodlPctExFees: 0,
});

test("saturdays: first Saturday on/after since, only fully settled weekends", () => {
  const since = Date.parse("2026-07-04T00:00:00Z") / 1000; // a Saturday
  const now = Date.parse("2026-09-23T07:00:00Z") / 1000;
  const s = saturdays(since, now);
  assert.equal(new Date(s[0] * 1000).toISOString().slice(0, 10), "2026-07-04");
  assert.equal(new Date(s.at(-1)! * 1000).toISOString().slice(0, 10), "2026-09-19");
  assert.equal(s.length, 12);
  const fromWed = saturdays(Date.parse("2026-07-01T00:00:00Z") / 1000, now);
  assert.equal(fromWed[0], s[0]);
  // a weekend whose Monday 01:00 settle hasn't happened yet is excluded
  assert.equal(saturdays(since, Date.parse("2026-09-21T00:30:00Z") / 1000).at(-1), s.at(-2));
});

test("classify: SPEC §3.5 buckets", () => {
  assert.equal(classify([w(2), w(3), w(1)]).bucket, "major");
  assert.equal(classify([w(16), w(40), w(1)]).bucket, "dislocation-prone", "two weekends > 15%");
  assert.equal(classify([w(2), w(317), w(1)]).bucket, "neither", "a single spike is not 'repeated'");
  assert.equal(classify([w(15), w(15)]).bucket, "neither", "strictly greater than 15%");
  assert.equal(classify([w(6), w(7)]).bucket, "neither");
});

test("classify: dead pools are ignored, all-dead -> ineligible", () => {
  assert.equal(classify([w(200, RULES.minSwapsPerWeekend - 1), w(2)]).bucket, "major", "a 4-swap spike is not evidence");
  assert.equal(classify([w(50, 0), w(null)]).bucket, "ineligible");
});
