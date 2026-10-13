const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

/**
 * Stubs PostgREST for sync_runs: GET lists the given `running` rows, POST records the upserted
 * rows (or answers 409 when `conflictOnInsert` is set, as the unique partial index would).
 */
function stubSyncRuns({ running = [], conflictOnInsert = false } = {}) {
  const writes = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    if (!url.pathname.endsWith("/sync_runs") && !url.pathname.endsWith("/sync_errors")) {
      throw new Error(`unexpected ${url.pathname}`);
    }
    if ((init.method || "GET") === "GET") {
      return { ok: true, status: 200, headers: new Map(), async json() { return running; }, async text() { return ""; } };
    }
    const rows = JSON.parse(init.body);
    if (conflictOnInsert && rows.some((row) => row.status === "running" && !running.some((r) => r.id === row.id))) {
      return {
        ok: false,
        status: 409,
        statusText: "Conflict",
        headers: new Map(),
        async text() { return '{"code":"23505","message":"duplicate key value violates unique constraint \\"sync_runs_one_running_per_pipeline\\""}'; },
      };
    }
    writes.push(...rows);
    return { ok: true, status: 201, headers: new Map(), async json() { return []; }, async text() { return ""; } };
  };
  return writes;
}

function setup() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  return jiti("@/lib/server/pipeline-orchestrator");
}

test("a run still working in another process is left alone, and this one is skipped", async () => {
  const { runPipeline } = setup();
  const originalFetch = global.fetch;
  const live = { id: "live", pipeline: "news_sync", status: "running", started_at: new Date(Date.now() - 60_000).toISOString() };
  const writes = stubSyncRuns({ running: [live] });
  let ran = false;
  try {
    const result = await runPipeline("news_sync", async () => { ran = true; return { recordCount: 1 }; });
    assert.equal(result.status, "skipped");
    assert.equal(ran, false);
    assert.equal(writes.length, 0, "the live run is not marked failed");
  } finally {
    global.fetch = originalFetch;
  }
});

test("a run older than the function timeout is superseded and the new run goes ahead", async () => {
  const { runPipeline } = setup();
  const originalFetch = global.fetch;
  const dead = { id: "dead", pipeline: "news_sync", status: "running", started_at: new Date(Date.now() - 20 * 60_000).toISOString() };
  const writes = stubSyncRuns({ running: [dead] });
  try {
    const result = await runPipeline("news_sync", async () => ({ recordCount: 3 }));
    assert.equal(result.status, "success");
    const superseded = writes.find((row) => row.id === "dead");
    assert.equal(superseded.status, "failed");
    assert.match(superseded.error_message, /superseded/i, "sync-health keeps ignoring these");
  } finally {
    global.fetch = originalFetch;
  }
});

test("losing the insert race to another process reports skipped instead of failing", async () => {
  const { runPipeline } = setup();
  const originalFetch = global.fetch;
  stubSyncRuns({ conflictOnInsert: true });
  let ran = false;
  try {
    const result = await runPipeline("news_sync", async () => { ran = true; return { recordCount: 1 }; });
    assert.equal(result.status, "skipped");
    assert.equal(ran, false);
  } finally {
    global.fetch = originalFetch;
  }
});
