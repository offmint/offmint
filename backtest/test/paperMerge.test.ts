// Weekend report auto-update: paper mode's per-weekend files become a labelled live observation (fixture, no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { paperRowsFor, paperSummary, saturdayOf, PAPER_LABEL } from "../src/paperMerge.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures/paper");

test("only the requested weekend's files are read; the largest paper size is used", () => {
  const rows = paperRowsFor(DIR, "2026-10-03");
  assert.deepEqual([...rows.keys()].sort(), ["CALM", "LIVE", "TEST"]);
  assert.equal(rows.get("TEST")!.vsHodlPctExFees, 2.25);
  assert.equal(rows.get("TEST")!.maxPremiumPct, 42.5);
  assert.equal(rows.get("LIVE")!.vsHodlPctExFees, null, "not settled yet: no result");
});

test("summary: incomplete while a token is still armed, labelled as a live observation of the paper engine", () => {
  const s = paperSummary(paperRowsFor(DIR, "2026-10-03"));
  assert.equal(s.tokens, 3);
  assert.equal(s.settled, 2);
  assert.equal(s.complete, false);
  assert.equal(s.filled, 1);
  assert.equal(s.label, PAPER_LABEL);
  assert.match(s.label, /live observation/);
  assert.match(s.label, /single band/, "never presented as the 4-step ladder");
});

test("a window keys on its Saturday, including holiday windows that start on Friday", () => {
  assert.equal(saturdayOf("2026-10-03T00:00:00.000Z"), "2026-10-03");
  assert.equal(saturdayOf("2026-07-03T00:00:00.000Z"), "2026-07-04");
  assert.equal(paperSummary(paperRowsFor(DIR, "2026-01-01")).tokens, 0);
});
