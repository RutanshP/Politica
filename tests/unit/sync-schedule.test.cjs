const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The nightly sync posts to paths written as strings in a shell script. Nothing checks them, so a
 * renamed or mistyped route fails silently -- the workflow's `post` helper downgrades a non-2xx to
 * a warning so one bad chunk cannot abort the run, which is right for a flaky upstream and wrong
 * for a path that will never work again.
 *
 * These tests are cheap and catch both that and a state route creeping back onto a schedule while
 * the state data is deleted.
 */

const ROOT = path.join(__dirname, "..", "..");
const WORKFLOW = path.join(ROOT, ".github/workflows/sync-daily.yml");
const CRON = path.join(ROOT, "app/api/cron/[job]/route.ts");

/** Every internal path either scheduler posts to, minus query strings and shell variables. */
function scheduledPaths(source) {
  return [...source.matchAll(/["'](\/api\/internal\/[^"'?\s]+)/g)]
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index);
}

function routeFileFor(apiPath) {
  return path.join(ROOT, "app", ...apiPath.split("/").filter(Boolean), "route.ts");
}

test("every path the nightly sync posts to is a real route", () => {
  const paths = scheduledPaths(fs.readFileSync(WORKFLOW, "utf8"));
  assert.ok(paths.length >= 6, `expected the workflow to still post to several routes, saw ${paths.length}`);

  for (const apiPath of paths) {
    assert.ok(
      fs.existsSync(routeFileFor(apiPath)),
      `${apiPath} is scheduled nightly but has no route file -- it would 404 on every run`,
    );
  }
});

test("every path the Vercel cron map posts to is a real route", () => {
  for (const apiPath of scheduledPaths(fs.readFileSync(CRON, "utf8"))) {
    assert.ok(
      fs.existsSync(routeFileFor(apiPath)),
      `${apiPath} is in the cron job map but has no route file`,
    );
  }
});

test("no scheduler writes state data", () => {
  // State coverage is off and its rows were deleted; a scheduled state sync would refill ~130MB.
  for (const [name, file] of [["sync-daily.yml", WORKFLOW], ["cron job map", CRON]]) {
    const scheduled = scheduledPaths(fs.readFileSync(file, "utf8"));
    const stateRoutes = scheduled.filter((apiPath) => /\/state-/.test(apiPath));
    assert.deepEqual(stateRoutes, [], `${name} schedules a state sync: ${stateRoutes.join(", ")}`);
  }
});

test("the governor rotation covers all fifty states exactly once", () => {
  /*
   * Governors are split across seven day-of-week buckets because OpenStates throttles to 10
   * requests a minute. A state missing from every bucket would simply never refresh, and one in
   * two buckets wastes a slot -- neither would raise anything at runtime.
   */
  const workflow = fs.readFileSync(WORKFLOW, "utf8");
  const buckets = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((day) => {
    const value = new RegExp(`GOV_${day}:\\s*"([^"]+)"`).exec(workflow)?.[1];
    assert.ok(value, `GOV_${day} should be set in the workflow`);
    return value.split(",").map((code) => code.trim()).filter(Boolean);
  });

  const all = buckets.flat();
  const unique = new Set(all);

  assert.equal(all.length, 50, `expected 50 state slots, saw ${all.length}`);
  assert.equal(unique.size, 50, "a state appears in more than one bucket");
});

test("the amendment sync stays within its request budget", () => {
  /*
   * With text extraction on, one bill costs a congress.gov call, a ~900KB Rules Committee page and
   * one PDF per amendment -- H.R. 8800 alone is ~21 requests. The route's budget is 300s, so a
   * large per-chunk limit risks timing out mid-write and hammering two House servers nightly.
   */
  const workflow = fs.readFileSync(WORKFLOW, "utf8");
  const limit = Number(/AMENDMENT_LIMIT:\s*"(\d+)"/.exec(workflow)?.[1]);

  assert.ok(Number.isFinite(limit), "AMENDMENT_LIMIT should be set in the workflow");
  assert.ok(limit <= 5, `AMENDMENT_LIMIT is ${limit}; above 5 a heavily amended bill can exceed the route's 300s budget`);
});
