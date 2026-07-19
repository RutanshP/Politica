import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { AnalyticsSnapshotRow } from "@/types/supabase";

// Excludes raw_payload -- a duplicate copy of `payload`, the field every caller actually reads.
const ANALYTICS_SNAPSHOT_SELECT = "id,key,payload,source_system,source_id,synced_at";

export async function listAnalyticsSnapshots() {
  return fetchSupabaseRows<AnalyticsSnapshotRow>("analytics_snapshots", "order=key.asc", {
    select: ANALYTICS_SNAPSHOT_SELECT,
  });
}

export async function getAnalyticsSnapshot(key: string) {
  const rows = await fetchSupabaseRows<AnalyticsSnapshotRow>(
    "analytics_snapshots",
    `key=eq.${encodeURIComponent(key)}&limit=1`,
    { select: ANALYTICS_SNAPSHOT_SELECT },
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
