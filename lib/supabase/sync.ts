import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { SyncErrorRow, SyncRunRow } from "@/types/supabase";

export async function listSyncRuns() {
  return fetchSupabaseRows<SyncRunRow>("sync_runs", "order=started_at.desc", {
    cache: "no-store",
  });
}

export async function getLatestSyncRun(pipeline: string) {
  const rows = await fetchSupabaseRows<SyncRunRow>(
    "sync_runs",
    `pipeline=eq.${encodeURIComponent(pipeline)}&order=started_at.desc&limit=1`,
    { cache: "no-store" },
  );
  return rows[0];
}

export async function upsertSyncRuns(rows: SyncRunRow[]) {
  return upsertSupabaseRows("sync_runs", rows, "id");
}

export async function upsertSyncErrors(rows: SyncErrorRow[]) {
  return upsertSupabaseRows("sync_errors", rows, "id");
}

export async function listRunningSyncRuns(pipeline: string) {
  return fetchSupabaseRows<SyncRunRow>(
    "sync_runs",
    `pipeline=eq.${encodeURIComponent(pipeline)}&status=eq.running&order=started_at.desc`,
    { cache: "no-store" },
  );
}
