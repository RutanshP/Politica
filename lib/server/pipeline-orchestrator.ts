import { randomUUID } from "node:crypto";

import { listRunningSyncRuns, upsertSyncErrors, upsertSyncRuns } from "@/lib/supabase/sync";
import type { SyncPipelineSummary } from "@/types/civic";
import type { SyncErrorRow, SyncRunRow } from "@/types/supabase";

// A client whose request times out (e.g. curl --max-time) does NOT abort the
// Next.js route handler: the worker keeps running server-side. If the caller
// then fires another chunk, a second worker starts concurrently, and since our
// sync workers share a process-wide FEC rate gate they progressively starve one
// another until none finish. This in-process lock guarantees at most one worker
// per pipeline per server process, so an abandoned request can never spawn an
// overlapping worker. It also protects the nightly cron from accidental double
// triggers. State is intentionally module-level (resets on server restart).
const runningPipelines = new Set<string>();

/*
 * The Set above only covers one process. Across Vercel instances (and anything else holding the
 * secret key) the lock is the `running` row itself: sync_runs_one_running_per_pipeline (migration
 * 044) lets only one exist per pipeline. A row is only treated as abandoned once it is older than
 * any function could run -- Vercel stops a route at its 300s maxDuration -- so a run that is still
 * working elsewhere is never marked failed underneath it.
 */
const ABANDONED_RUN_AFTER_MS = 330_000;

function skippedSummary(pipeline: string, startedAt: string, reason: string): SyncPipelineSummary {
  return {
    pipeline,
    status: "skipped",
    startedAt,
    finishedAt: startedAt,
    recordCount: 0,
    metadata: { skipped: true, reason },
  };
}

function isUniqueViolation(error: unknown) {
  return error instanceof Error && /\b409\b|23505/.test(error.message);
}

export async function runPipeline(
  pipeline: string,
  worker: () => Promise<{ recordCount: number; metadata?: unknown }>,
): Promise<SyncPipelineSummary> {
  const startedAt = new Date().toISOString();

  if (runningPipelines.has(pipeline)) {
    return skippedSummary(pipeline, startedAt, "A run for this pipeline is already in progress");
  }
  runningPipelines.add(pipeline);
  try {
    return await runPipelineLocked(pipeline, worker, startedAt);
  } finally {
    runningPipelines.delete(pipeline);
  }
}

async function runPipelineLocked(
  pipeline: string,
  worker: () => Promise<{ recordCount: number; metadata?: unknown }>,
  startedAt: string,
): Promise<SyncPipelineSummary> {
  const runningRows = await listRunningSyncRuns(pipeline).catch(() => []);
  const abandonedBefore = Date.parse(startedAt) - ABANDONED_RUN_AFTER_MS;
  const abandoned = runningRows.filter((row) => Date.parse(row.started_at) < abandonedBefore);
  if (abandoned.length < runningRows.length) {
    return skippedSummary(pipeline, startedAt, "A run for this pipeline is already in progress elsewhere");
  }
  if (abandoned.length > 0) {
    await upsertSyncRuns(
      abandoned.map((row) => ({
        ...row,
        status: "failed",
        finished_at: startedAt,
        // sync-health ignores "superseded" rows; the real outcome of that chunk is the 504 the
        // caller already saw.
        error_message: row.error_message || "Superseded: no finish was recorded within the function timeout",
      })),
    ).catch(() => undefined);
  }

  const runningRow: SyncRunRow = {
    id: randomUUID(),
    pipeline,
    status: "running",
    record_count: 0,
    started_at: startedAt,
    finished_at: null,
    error_message: null,
    metadata: {},
  };

  try {
    await upsertSyncRuns([runningRow]);
  } catch (error) {
    // Another process inserted its own `running` row between the read above and this write.
    if (isUniqueViolation(error)) {
      return skippedSummary(pipeline, startedAt, "A run for this pipeline is already in progress elsewhere");
    }
    throw error;
  }

  try {
    const result = await worker();
    const finishedAt = new Date().toISOString();

    await upsertSyncRuns([{
      ...runningRow,
      status: "success",
      record_count: result.recordCount,
      finished_at: finishedAt,
      metadata: result.metadata ?? {},
    }]);

    return {
      pipeline,
      status: "success",
      startedAt,
      finishedAt,
      recordCount: result.recordCount,
      metadata: result.metadata,
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Unknown pipeline error";
    const errorRow: SyncErrorRow = {
      id: randomUUID(),
      pipeline,
      stage: "worker",
      message,
      payload: {
        startedAt,
      },
      created_at: finishedAt,
    };

    await Promise.all([
      upsertSyncRuns([{
        ...runningRow,
        status: "failed",
        finished_at: finishedAt,
        error_message: message,
      }]),
      upsertSyncErrors([errorRow]),
    ]);

    return {
      pipeline,
      status: "failed",
      startedAt,
      finishedAt,
      recordCount: 0,
      error: message,
      metadata: undefined,
    };
  }
}
