import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { AnalyticsSnapshotRow } from "@/types/supabase";

export async function listAnalyticsSnapshots() {
  return fetchSupabaseRows<AnalyticsSnapshotRow>("analytics_snapshots", "order=key.asc");
}

export async function getAnalyticsSnapshot(key: string) {
  const rows = await fetchSupabaseRows<AnalyticsSnapshotRow>(
    "analytics_snapshots",
    `key=eq.${encodeURIComponent(key)}&limit=1`,
  );
  return rows[0];
}

export async function replaceAnalyticsSnapshots(rows: AnalyticsSnapshotRow[]) {
  await deleteSupabaseRows("analytics_snapshots", "id=not.is.null");
  if (rows.length === 0) {
    return [];
  }
  return upsertSupabaseRows("analytics_snapshots", rows, "id");
}
