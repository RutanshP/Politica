import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";

function mapRowToPolitician(row: PoliticianRow): Politician {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    title: row.title,
    party: row.party,
    state: row.state,
    district: row.district || undefined,
    biography: row.biography,
    born: row.born,
    education: row.education,
    occupation: row.occupation,
    website: row.website,
    officePhone: row.office_phone,
    officeAddress: row.office_address,
    nextElection: row.next_election,
    jurisdictionType: row.jurisdiction_type,
    sessionId: row.session_id || undefined,
    stats: row.stats,
    ideology: row.ideology,
    sourceMetadata: {
      sourceSystem: row.source_system || row.source,
      sourceId: row.source_id || row.id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload || row.raw_member),
    },
  };
}

export async function listStoredPoliticians() {
  const rows = await fetchSupabaseRows<PoliticianRow>("politicians", "order=name.asc");
  return rows.map(mapRowToPolitician);
}

export async function getStoredPoliticianBySlug(slug: string) {
  const rows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    `slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  const row = rows[0];
  return row ? mapRowToPolitician(row) : undefined;
}

export async function upsertStoredPoliticians(rows: PoliticianRow[]) {
  return upsertSupabaseRows("politicians", rows, "id");
}
