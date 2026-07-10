import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { SyncErrorRow, SyncRunRow } from "@/types/supabase";

export async function listSyncRuns() {
  return fetchSupabaseRows<SyncRunRow>("sync_runs", "order=started_at.desc");
}

export async function getLatestSyncRun(pipeline: string) {
  const rows = await fetchSupabaseRows<SyncRunRow>(
    "sync_runs",
    `pipeline=eq.${encodeURIComponent(pipeline)}&order=started_at.desc&limit=1`,
  );
  return rows[0];
}

export async function upsertSyncRuns(rows: SyncRunRow[]) {
  return upsertSupabaseRows("sync_runs", rows, "id");
}

export async function upsertSyncErrors(rows: SyncErrorRow[]) {
  return upsertSupabaseRows("sync_errors", rows, "id");
}
