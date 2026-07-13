import { COMMITTEES_CACHE_TAG } from "@/lib/supabase/cache-tags";
import type { Committee, CommitteeMembership } from "@/types/civic";
import { mapRowToCommittee } from "@/lib/normalizers/legislation";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { CommitteeMemberRow, CommitteeRow } from "@/types/supabase";

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function mapRowToCommitteeMembership(row: CommitteeMemberRow): CommitteeMembership {
  return {
    committeeId: row.committee_id,
    politicianId: row.politician_id,
    role: row.role,
    sortOrder: row.sort_order,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

/**
 * Excludes raw_committee / raw_payload -- duplicate copies of the source blob that nothing on
 * the read path reads beyond a `rawAvailable` boolean. select=* on this table was ~562KB.
 */
const COMMITTEE_SELECT = [
  "id", "slug", "name", "chamber", "jurisdiction", "chair", "ranking_member", "description",
  "hearing", "active_bill_ids", "member_ids", "contact_url", "contact_phone", "contact_address",
  "subcommittees", "source", "source_system", "source_id", "jurisdiction_type", "state_code",
  "session_id", "synced_at",
].join(",");

const COMMITTEE_MEMBER_SELECT = "committee_id,politician_id,role,sort_order";

export async function listStoredCommittees(options?: { fresh?: boolean }) {
  const rows = await fetchSupabaseRows<CommitteeRow>("committees", undefined, {
    ...(options?.fresh ? { cache: "no-store" as const } : { tags: [COMMITTEES_CACHE_TAG] }),
    select: COMMITTEE_SELECT,
    paginateAll: true,
  });
  return rows.map(mapRowToCommittee).sort((left, right) => left.name.localeCompare(right.name));
}

export async function getStoredCommitteeBySlug(slug: string) {
  const rows = await fetchSupabaseRows<CommitteeRow>(
    "committees",
    `slug=eq.${encodeURIComponent(slug)}&limit=1`,
    { select: COMMITTEE_SELECT, tags: [COMMITTEES_CACHE_TAG] },
  );
  const row = rows[0];
  return row ? mapRowToCommittee(row) : undefined;
}

export async function getStoredCommitteeById(id: string) {
  const rows = await fetchSupabaseRows<CommitteeRow>(
    "committees",
    `id=eq.${encodeURIComponent(id)}&limit=1`,
    { select: COMMITTEE_SELECT, tags: [COMMITTEES_CACHE_TAG] },
  );
  const row = rows[0];
  return row ? mapRowToCommittee(row) : undefined;
}

export async function upsertStoredCommittees(rows: CommitteeRow[]) {
  return upsertSupabaseRows("committees", rows, "id");
}

export async function listStoredCommitteeMemberships() {
  const rows = await fetchSupabaseRows<CommitteeMemberRow>(
    "committee_members",
    "order=committee_id.asc,sort_order.asc",
    { select: COMMITTEE_MEMBER_SELECT, tags: [COMMITTEES_CACHE_TAG], paginateAll: true },
  );
  return rows.map(mapRowToCommitteeMembership);
}

export async function listStoredCommitteeMembershipsByCommitteeId(committeeId: string) {
  const rows = await fetchSupabaseRows<CommitteeMemberRow>(
    "committee_members",
    `committee_id=eq.${encodeURIComponent(committeeId)}&order=sort_order.asc`,
    { select: COMMITTEE_MEMBER_SELECT, tags: [COMMITTEES_CACHE_TAG], paginateAll: true },
  );
  return rows.map(mapRowToCommitteeMembership);
}

export async function listStoredCommitteeMembershipsByPoliticianId(politicianId: string) {
  const rows = await fetchSupabaseRows<CommitteeMemberRow>(
    "committee_members",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=sort_order.asc`,
    { select: COMMITTEE_MEMBER_SELECT, tags: [COMMITTEES_CACHE_TAG], paginateAll: true },
  );
  return rows.map(mapRowToCommitteeMembership);
}

export async function replaceStoredCommitteeMemberships(
  committeeIds: string[],
  rows: CommitteeMemberRow[],
) {
  if (committeeIds.length > 0) {
    await deleteSupabaseRows("committee_members", `committee_id=in.(${buildQuotedInFilter(committeeIds)})`);
  }

  if (rows.length === 0) {
    return [];
  }

  return upsertSupabaseRows("committee_members", rows, "committee_id,politician_id");
}

export function mergeCommitteeMembershipIds(
  committees: Committee[],
  memberships: CommitteeMembership[],
) {
  const memberIdsByCommitteeId = new Map<string, string[]>();

  memberships.forEach((membership) => {
    const current = memberIdsByCommitteeId.get(membership.committeeId) || [];
    if (!current.includes(membership.politicianId)) {
      current.push(membership.politicianId);
    }
    memberIdsByCommitteeId.set(membership.committeeId, current);
  });

  return committees.map((committee) => ({
    ...committee,
    memberIds: memberIdsByCommitteeId.get(committee.id) || committee.memberIds,
  }));
}
