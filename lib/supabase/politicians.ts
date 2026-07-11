import type { Politician } from "@/types/civic";
import type { PoliticianRow } from "@/types/supabase";
import { fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import { normalizePartyLabel, normalizeStateLabel } from "@/lib/utils";

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function fallbackPoliticianName(row: PoliticianRow) {
  if (row.name?.trim()) {
    return row.name.trim();
  }

  const rawMember = (row.raw_member ?? row.raw_payload ?? {}) as Record<string, unknown>;
  const directName = normalizeWhitespace([
    typeof rawMember.honorificName === "string" ? rawMember.honorificName : "",
    typeof rawMember.firstName === "string" ? rawMember.firstName : "",
    typeof rawMember.lastName === "string" ? rawMember.lastName : "",
  ].filter(Boolean).join(" "));

  if (directName) {
    return directName;
  }

  if (typeof rawMember.name === "string" && rawMember.name.trim()) {
    return rawMember.name.trim();
  }

  if (typeof rawMember.invertedOrderName === "string" && rawMember.invertedOrderName.trim()) {
    const rebuilt = normalizeWhitespace(
      rawMember.invertedOrderName
        .split(",")
        .reverse()
        .join(" "),
    ).replace(/^,+|,+$/g, "").trim();

    if (rebuilt) {
      return rebuilt;
    }
  }

  return row.title?.trim() || row.id;
}

function mapRowToPolitician(row: PoliticianRow): Politician {
  const name = fallbackPoliticianName(row);

  return {
    id: row.id,
    slug: row.slug || row.id,
    name,
    title: row.title,
    party: normalizePartyLabel(row.party),
    state: normalizeStateLabel(row.state),
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
  const rows = await fetchSupabaseRows<PoliticianRow>("politicians", "order=name.asc", {
    cache: "no-store",
  });
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
