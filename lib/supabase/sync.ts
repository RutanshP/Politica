import { cache } from "react";

import { SYNC_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { SyncErrorRow, SyncRunRow } from "@/types/supabase";

export async function listSyncRuns() {
  return fetchSupabaseRows<SyncRunRow>("sync_runs", "order=started_at.desc&limit=50", {
    cache: "no-store",
  });
}

/**
 * Every lib/data/* function calls this (2-4x per render) to label the "Stored data" badge.
 *
 * It used to pass `cache: "no-store"`, which opted every route that rendered a badge -- that is,
 * every route -- out of Next's Data Cache and forced dynamic rendering. Cached + tagged means
 * the badge refreshes when a sync writes, not on every request. React `cache` collapses the
 * repeat calls within a single render.
 */
export const getLatestSyncRun = cache(async (pipeline: string) => {
  const rows = await fetchSupabaseRows<SyncRunRow>(
    "sync_runs",
    `pipeline=eq.${encodeURIComponent(pipeline)}&order=started_at.desc&limit=1`,
    { select: "id,pipeline,status,started_at,finished_at", tags: [SYNC_CACHE_TAG] },
  );
  return rows[0];
});

export async function upsertSyncRuns(rows: SyncRunRow[]) {
  return upsertSupabaseRows("sync_runs", rows, "id");
}

export async function upsertSyncErrors(rows: SyncErrorRow[]) {
  return upsertSupabaseRows("sync_errors", rows, "id");
}

export async function listRunningSyncRuns(pipeline: string) {
  // Concurrency guard for the sync orchestrator: must observe current state, never a cache.
  return fetchSupabaseRows<SyncRunRow>(
    "sync_runs",
    `pipeline=eq.${encodeURIComponent(pipeline)}&status=eq.running&order=started_at.desc`,
    { cache: "no-store" },
  );
}
