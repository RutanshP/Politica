const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const NOW = Date.parse("2026-09-20T11:00:00Z");
const hoursAgo = (hours) => new Date(NOW - hours * 3_600_000).toISOString();

/** A healthy recent success for every scheduled pipeline, so each test changes one thing. */
function healthyRuns() {
  const { PIPELINE_LABELS } = jiti("@/lib/server/sync-health");
  return Object.keys(PIPELINE_LABELS).map((pipeline) => ({
    pipeline,
    status: "success",
    started_at: hoursAgo(2),
    error_message: null,
    metadata: pipeline === "lobbying_filings_sync" ? { done: true, nextPostedAfter: hoursAgo(3) } : {},
  }));
}

async function check(runs) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-secret";
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, headers: new Map(), async json() { return runs; } });
  try {
    const { checkSyncHealth } = jiti("@/lib/server/sync-health");
    return await checkSyncHealth({ now: NOW });
  } finally {
    global.fetch = originalFetch;
  }
}

test("all pipelines recently successful is healthy", async () => {
  const report = await check(healthyRuns());
  assert.equal(report.ok, true, JSON.stringify(report.issues));
});

test("a pipeline with no success inside its window is stale, with the last real error", async () => {
  const runs = healthyRuns().filter((run) => run.pipeline !== "news_sync");
  runs.push(
    { pipeline: "news_sync", status: "failed", started_at: hoursAgo(5), error_message: "News API request failed: 429", metadata: {} },
    { pipeline: "news_sync", status: "success", started_at: hoursAgo(80), error_message: null, metadata: {} },
  );
  const report = await check(runs);
  assert.equal(report.ok, false);
  const issue = report.issues.find((item) => item.pipeline === "news_sync");
  assert.equal(issue.kind, "stale");
  assert.match(issue.detail, /429/);
});

test("a run that succeeded but could not read its PDFs is a silent failure", async () => {
  const runs = healthyRuns().map((run) =>
    run.pipeline === "stock_disclosure_sync"
      ? { ...run, metadata: { byStatus: { parsed: 12, extract_failed: 128 }, errors: ["DOMMatrix is not defined"] } }
      : run.pipeline === "bill_amendment_links"
        ? { ...run, metadata: { textFailures: { extractionError: 52 }, firstTextError: "DOMMatrix is not defined" } }
        : run,
  );
  const report = await check(runs);
  const kinds = report.issues.map((item) => `${item.pipeline}:${item.kind}`).sort();
  assert.deepEqual(kinds, ["bill_amendment_links:silent-failure", "stock_disclosure_sync:silent-failure"]);
});

test("one unreadable PDF is not an alert", async () => {
  const runs = healthyRuns().map((run) =>
    run.pipeline === "stock_disclosure_sync" ? { ...run, metadata: { byStatus: { parsed: 140, extract_failed: 1 } } } : run,
  );
  assert.equal((await check(runs)).ok, true);
});

test("a superseded run does not count as the latest failure", async () => {
  const runs = healthyRuns();
  runs.unshift({ pipeline: "federal_legislation_sync", status: "failed", started_at: hoursAgo(1), error_message: "Superseded by a newer pipeline run", metadata: {} });
  const report = await check(runs);
  assert.equal(report.ok, true);
  assert.equal(report.warnings.length, 0);
});

test("a lobbying cursor days behind is flagged", async () => {
  const runs = healthyRuns().map((run) =>
    run.pipeline === "lobbying_filings_sync" ? { ...run, metadata: { done: false, nextPostedAfter: hoursAgo(24 * 6) } } : run,
  );
  const report = await check(runs);
  assert.deepEqual(report.issues.map((item) => item.kind), ["behind"]);
});
