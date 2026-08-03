const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const jiti = require("../support/jiti.cjs");

/*
 * State legislature coverage is off and its stored data was deleted -- 260,564 vote positions,
 * 7,534 roll calls, 1,668 legislators, 419 committees, 128 bills. Over half the database.
 *
 * The syncs still exist because the code is correct and states may come back. That is exactly what
 * makes this worth a test: one authenticated call to /state-votes would restore ~130MB, and the
 * gate is three lines that a later edit could drop without anything failing. Same reasoning as
 * raw-payload-guard.test.cjs, which caught a real regression on its first run.
 */

const ROOT = path.join(__dirname, "..", "..");
const GATED_ROUTES = [
  "app/api/internal/sync/state-votes/route.ts",
  "app/api/internal/sync/state-legislation/route.ts",
];

test("state sync is disabled unless the environment opts in", () => {
  const { isStateSyncEnabled } = jiti("@/lib/server/internal-api");
  const original = process.env.POLITICA_ENABLE_STATE_SYNC;

  try {
    delete process.env.POLITICA_ENABLE_STATE_SYNC;
    assert.equal(isStateSyncEnabled(), false, "must default to off");

    process.env.POLITICA_ENABLE_STATE_SYNC = "";
    assert.equal(isStateSyncEnabled(), false, "empty must not count as opting in");

    process.env.POLITICA_ENABLE_STATE_SYNC = "1";
    assert.equal(isStateSyncEnabled(), true);
    process.env.POLITICA_ENABLE_STATE_SYNC = "true";
    assert.equal(isStateSyncEnabled(), true);
  } finally {
    if (original === undefined) delete process.env.POLITICA_ENABLE_STATE_SYNC;
    else process.env.POLITICA_ENABLE_STATE_SYNC = original;
  }
});

test("state sync returns 410 while disabled, and nothing while enabled", async () => {
  const { stateSyncDisabledResponse } = jiti("@/lib/server/internal-api");
  const original = process.env.POLITICA_ENABLE_STATE_SYNC;

  try {
    delete process.env.POLITICA_ENABLE_STATE_SYNC;
    const blocked = stateSyncDisabledResponse();
    assert.ok(blocked, "must return a response while disabled");
    assert.equal(blocked.status, 410);
    const body = await blocked.json();
    assert.match(body.error, /disabled/i);

    process.env.POLITICA_ENABLE_STATE_SYNC = "1";
    assert.equal(stateSyncDisabledResponse(), null, "must not block once enabled");
  } finally {
    if (original === undefined) delete process.env.POLITICA_ENABLE_STATE_SYNC;
    else process.env.POLITICA_ENABLE_STATE_SYNC = original;
  }
});

test("every state-writing route still checks the gate", () => {
  for (const route of GATED_ROUTES) {
    const file = path.join(ROOT, route);
    assert.ok(fs.existsSync(file), `${route} moved -- update GATED_ROUTES or the gate stops covering it`);

    const source = fs.readFileSync(file, "utf8");
    assert.match(
      source,
      /stateSyncDisabledResponse\(\)/,
      `${route} no longer calls stateSyncDisabledResponse() -- state data can be restored by a single request`,
    );
  }
});

test("the nightly sync does not call a state route", () => {
  // These were never scheduled, and must not be added back while the data is deleted.
  const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/sync-daily.yml"), "utf8");
  assert.doesNotMatch(workflow, /sync\/state-/, "sync-daily.yml schedules a state sync");

  const cron = fs.readFileSync(path.join(ROOT, "app/api/cron/[job]/route.ts"), "utf8");
  assert.doesNotMatch(cron, /sync\/state-/, "the cron job map schedules a state sync");
});
