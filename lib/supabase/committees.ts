import { mapRowToCommittee } from "@/lib/normalizers/legislation";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { CommitteeRow } from "@/types/supabase";

export async function listStoredCommittees() {
  const rows = await fetchSupabaseRows<CommitteeRow>("committees");
  return rows.map(mapRowToCommittee).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getStoredCommitteeBySlug(slug: string) {
  const rows = await fetchSupabaseRows<CommitteeRow>(
    "committees",
    `slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  const row = rows[0];
  return row ? mapRowToCommittee(row) : undefined;
}

export async function upsertStoredCommittees(rows: CommitteeRow[]) {
  return upsertSupabaseRows("committees", rows, "id");
}
