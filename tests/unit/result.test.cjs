const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { withData, emptyResult } = jiti("@/lib/data/result");

test("withData marks stale when no sync timestamp exists", () => {
  const result = withData("supabase", "pipeline", [1, 2, 3]);
  assert.equal(result.availability, "live");
  assert.equal(result.freshness.pipeline, "pipeline");
  assert.equal(result.freshness.stale, true);
});

test("emptyResult preserves explicit availability and error", () => {
  const result = emptyResult("unavailable", "pipeline", [], "unavailable", "boom");
  assert.equal(result.availability, "unavailable");
  assert.equal(result.error, "boom");
});
