import type { Bill, Committee } from "@/types/civic";
import type { BillActionRow, BillRow, BillVersionRow, CommitteeRow } from "@/types/supabase";
import { formatSummaryText, normalizeStateLabel, slugifySegment } from "@/lib/utils";

function parseDateLabel(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortBillsByActivity(bills: Bill[]) {
  return [...bills].sort((left, right) => parseDateLabel(right.lastActionAt) - parseDateLabel(left.lastActionAt));
}

export function mapBillToRow(
  bill: Bill,
  rawBill: unknown,
  options?: {
    sourceUpdatedAt?: string | null;
    sourceFingerprint?: string | null;
    lastDetailSyncedAt?: string | null;
    lastActionsSyncedAt?: string | null;
    lastVersionsSyncedAt?: string | null;
    lastVotesSyncedAt?: string | null;
  },
): BillRow {
  const now = new Date().toISOString();
  return {
    id: bill.id,
    slug: bill.slug || slugifySegment(`${bill.number}-${bill.title}`),
    number: bill.number,
    title: bill.title,
    summary: bill.summary,
    jurisdiction: bill.jurisdiction,
    country: bill.country,
    state: bill.state || null,
    chamber: bill.chamber,
    status: bill.status,
    topic: bill.topic,
    sponsor_id: bill.sponsorId,
    sponsor_name: bill.sponsorName,
    committee_id: bill.committeeId,
    committee_name: bill.committeeName,
    latest_action: bill.latestAction,
    last_action_at: bill.lastActionAt,
    introduced_at: bill.introducedAt,
    session: bill.session,
    chance_of_passing: bill.chanceOfPassing,
    stats: bill.stats,
    related_bill_ids: bill.relatedBillIds,
    source: "congress_sync",
    source_system: bill.sourceMetadata?.sourceSystem || "congress",
    source_id: bill.sourceMetadata?.sourceId || bill.id,
    jurisdiction_type: bill.jurisdiction === "Federal" ? "federal" : "state",
    state_code: bill.state || null,
    session_id: bill.sessionId || null,
    source_updated_at: options?.sourceUpdatedAt || null,
    source_fingerprint: options?.sourceFingerprint || null,
    last_detail_synced_at: options?.lastDetailSyncedAt || null,
    last_actions_synced_at: options?.lastActionsSyncedAt || null,
    last_versions_synced_at: options?.lastVersionsSyncedAt || null,
    last_votes_synced_at: options?.lastVotesSyncedAt || null,
    synced_at: now,
    // raw_bill holds the source blob (the incremental sync reads it to avoid re-fetching detail).
    // raw_payload used to hold a byte-identical copy, which doubled this table's TOAST size for no
    // benefit -- nothing reads it (the "raw available" badge falls back to raw_bill). Keep the key
    // present but always null: PostgREST rejects a bulk upsert whose objects don't all share keys
    // (PGRST102), so the column must appear on every row in a chunk.
    raw_payload: null,
    raw_bill: rawBill ?? null,
  };
}

export function mapBillActionToRow(billId: string, action: Bill["actions"][number], sortOrder: number): BillActionRow {
  return {
    bill_id: billId,
    sort_order: sortOrder,
    date: action.date,
    label: action.label,
    detail: action.detail,
    type: action.type,
  };
}

export function mapBillVersionToRow(billId: string, version: Bill["versions"][number], sortOrder: number): BillVersionRow {
  return {
    bill_id: billId,
    version_id: version.id,
    sort_order: sortOrder,
    label: version.label,
    date: version.date,
    type: version.type,
    content: version.content,
    source_url: version.sourceUrl || null,
    formats: version.formats || [],
    is_full_text_available: Boolean(version.isFullTextAvailable),
  };
}

export function mapRowToBill(
  row: BillRow,
  actions: BillActionRow[],
  versions: BillVersionRow[],
): Bill {
  return {
    id: row.id,
    slug: row.slug || undefined,
    number: row.number,
    title: row.title,
    summary: formatSummaryText(row.summary),
    jurisdiction: row.jurisdiction,
    country: row.country,
    state: row.state ? normalizeStateLabel(row.state) : undefined,
    chamber: row.chamber,
    status: row.status,
    topic: row.topic,
    sponsorId: row.sponsor_id,
    sponsorName: row.sponsor_name,
    committeeId: row.committee_id,
    committeeName: row.committee_name,
    latestAction: row.latest_action,
    lastActionAt: row.last_action_at,
    introducedAt: row.introduced_at,
    session: row.session,
    chanceOfPassing: row.chance_of_passing,
    stats: row.stats,
    actions: actions
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((action) => ({
        date: action.date,
        label: action.label,
        detail: action.detail,
        type: action.type,
      })),
    versions: versions
      .sort((left, right) =>
        parseDateLabel(right.date) - parseDateLabel(left.date)
        || right.sort_order - left.sort_order,
      )
      .map((version) => ({
        id: version.version_id,
        label: version.label,
        date: version.date,
        type: version.type,
        content: version.content,
        sourceUrl: version.source_url || undefined,
        formats: version.formats || [],
        isFullTextAvailable: Boolean(version.is_full_text_available),
      })),
    relatedBillIds: row.related_bill_ids,
    jurisdictionType: row.jurisdiction_type,
    sessionId: row.session_id || undefined,
    sourceMetadata: {
      sourceSystem: row.source_system || row.source,
      sourceId: row.source_id || row.id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload || row.raw_bill),
    },
  };
}

export function mapCommitteeToRow(committee: Committee, rawCommittee: unknown): CommitteeRow {
  return {
    id: committee.id,
    slug: committee.slug,
    name: committee.name,
    chamber: committee.chamber,
    jurisdiction: committee.jurisdiction,
    chair: committee.chair,
    ranking_member: committee.rankingMember,
    description: committee.description,
    hearing: committee.hearing,
    active_bill_ids: committee.activeBillIds,
    member_ids: committee.memberIds,
    contact_url: committee.contactUrl || null,
    contact_phone: committee.contactPhone || null,
    contact_address: committee.contactAddress || null,
    subcommittees: committee.subcommittees || [],
    source: "congress_sync",
    source_system: committee.sourceMetadata?.sourceSystem || "congress",
    source_id: committee.sourceMetadata?.sourceId || committee.id,
    jurisdiction_type: committee.jurisdictionType || "federal",
    state_code: null,
    session_id: committee.sessionId || null,
    synced_at: new Date().toISOString(),
    raw_payload: rawCommittee ?? null,
    raw_committee: rawCommittee ?? null,
  };
}

export function mapRowToCommittee(row: CommitteeRow): Committee {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    chamber: row.chamber,
    jurisdiction: row.jurisdiction,
    chair: row.chair,
    rankingMember: row.ranking_member,
    description: row.description,
    hearing: row.hearing,
    activeBillIds: row.active_bill_ids,
    memberIds: row.member_ids,
    contactUrl: row.contact_url || undefined,
    contactPhone: row.contact_phone || undefined,
    contactAddress: row.contact_address || undefined,
    subcommittees: row.subcommittees || [],
    jurisdictionType: row.jurisdiction_type,
    sessionId: row.session_id || undefined,
    sourceMetadata: {
      sourceSystem: row.source_system || row.source,
      sourceId: row.source_id || row.id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload || row.raw_committee),
    },
  };
}
