import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPath } from "../src/detect.js";

test("detector paths: feed graduates; no-feed splits on pool age", () => {
  assert.equal(classifyPath(true, 3, 30), "chainlink", "a feed always wins (graduated)");
  assert.equal(classifyPath(false, 12, 30), "new-listing");
  assert.equal(classifyPath(false, 30, 30), "new-listing", "boundary inclusive");
  assert.equal(classifyPath(false, 31, 30), "no-feed");
  assert.equal(classifyPath(false, null, 30), "no-feed", "unknown age is not treated as new");
});
