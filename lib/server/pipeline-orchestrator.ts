import { randomUUID } from "node:crypto";

import { listRunningSyncRuns, upsertSyncErrors, upsertSyncRuns } from "@/lib/supabase/sync";
import type { SyncPipelineSummary } from "@/types/civic";
import type { SyncErrorRow, SyncRunRow } from "@/types/supabase";

export async function runPipeline(
  pipeline: string,
  worker: () => Promise<{ recordCount: number; metadata?: unknown }>,
): Promise<SyncPipelineSummary> {
  const startedAt = new Date().toISOString();
  const staleRunningRows = await listRunningSyncRuns(pipeline).catch(() => []);
  if (staleRunningRows.length > 0) {
    await upsertSyncRuns(
      staleRunningRows.map((row) => ({
        ...row,
        status: "failed",
        finished_at: startedAt,
        error_message: row.error_message || "Superseded by a newer pipeline run",
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

  await upsertSyncRuns([runningRow]);

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
