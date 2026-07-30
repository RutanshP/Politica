import type { Bill, Committee } from "@/types/civic";
import type { BillActionRow, BillRow, BillVersionRow, CommitteeRow } from "@/types/supabase";
import {
  formatInlineText,
  formatSummaryText,
  normalizeCommitteeChamber,
  normalizeStateLabel,
  slugifySegment,
} from "@/lib/utils";

function parseDateLabel(value: string) {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortBillsByActivity(bills: Bill[]) {
  return [...bills].sort((left, right) => parseDateLabel(right.lastActionAt) - parseDateLabel(left.lastActionAt));
}

/**
 * Congress.gov restates an action it has already listed, prefixed with the stage that reported it.
 * "Passed/agreed to in House: On motion to suspend the rules..." is the same floor vote as the
 * bare "On motion to suspend the rules...", filed a second time by a different source feed.
 */
const ACTION_RESTATEMENT_PREFIXES: RegExp[] = [
  /^passed\/agreed to in (?:house|senate):\s*/i,
  /^resolving differences\s*--\s*(?:house|senate) actions:\s*/i,
];

/**
 * Which label to keep when the same action arrives under several of them, most specific first.
 *
 * Congress.gov files one action under multiple stage codes -- "Became Public Law No: 119-101."
 * arrives as both `President` and `BecameLaw`, "Presented to President." as both `Floor` and
 * `President` -- and the timeline rendered each one as its own entry. Every collision observed in
 * the stored data (Discharge/Committee, President/BecameLaw, Floor/President, Committee/
 * IntroReferral) resolves correctly by keeping the label further along this list.
 */
const ACTION_LABEL_PRIORITY = [
  "BecameLaw",
  "Veto",
  "President",
  "ResolvingDifferences",
  "Discharge",
  "Calendars",
  "Committee",
  "Floor",
  "IntroReferral",
  "Latest action",
  "NotUsed",
];

function actionLabelRank(label: string) {
  const index = ACTION_LABEL_PRIORITY.indexOf(label);
  // An unrecognised label is worth keeping over one we know to be vague, but not over a milestone.
  return index === -1 ? ACTION_LABEL_PRIORITY.indexOf("Floor") : index;
}

function stripActionRestatement(detail: string) {
  let text = detail;
  for (const prefix of ACTION_RESTATEMENT_PREFIXES) {
    text = text.replace(prefix, "");
  }
  return text.trim();
}

/**
 * Collapses the same action reported more than once for a bill.
 *
 * Deduped on read rather than on write: the duplicates are already stored for ~18k bills, and the
 * source keeps sending them, so filtering here fixes the existing rows without a full re-sync and
 * keeps future ones from reappearing.
 */
export function dedupeBillActions<T extends { date: string; label: string; detail: string; type: string }>(
  actions: T[],
): T[] {
  const byKey = new Map<string, { action: T; order: number }>();

  actions.forEach((action, order) => {
    const detail = stripActionRestatement(action.detail || "");
    const key = `${action.date}|${detail.replace(/\s+/g, " ").toLowerCase()}`;
    const existing = byKey.get(key);

    if (!existing) {
      // Keep the de-prefixed text: it is the action itself, not a stage's restatement of it.
      byKey.set(key, { action: { ...action, detail }, order });
      return;
    }

    if (actionLabelRank(action.label) < actionLabelRank(existing.action.label)) {
      // Hold the earliest position so a later restatement cannot move the action down the timeline.
      byKey.set(key, { action: { ...action, detail }, order: existing.order });
    }
  });

  return [...byKey.values()]
    .sort((left, right) => left.order - right.order)
    .map((entry) => entry.action);
}

export function mapBillToRow(
  bill: Bill,
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
    // Both source blobs stay null. raw_bill held the Congress.gov payload for every bill -- 44MB of
    // TOAST, 11% of the whole database -- and nothing ever read it: it was selected on each sync
    // only to be written straight back, and its sole consumer was `Boolean(raw_bill)` behind a
    // `rawAvailable` flag no component renders. Selecting it on every run was also a large share of
    // the egress. Same call as the votes.raw_payload reclaim in 018.
    //
    // The keys stay present but null: PostgREST rejects a bulk upsert whose objects don't all share
    // keys (PGRST102), so each column must appear on every row in a chunk.
    raw_payload: null,
    raw_bill: null,
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
    title: formatInlineText(row.title),
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
    latestAction: formatInlineText(row.latest_action),
    lastActionAt: row.last_action_at,
    introducedAt: row.introduced_at,
    session: row.session,
    chanceOfPassing: row.chance_of_passing,
    stats: row.stats,
    actions: dedupeBillActions(
      actions
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((action) => ({
          date: action.date,
          label: action.label,
          detail: action.detail,
          type: action.type,
        })),
    ),
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
  const rawChamber = (row.chamber || "").trim().toLowerCase();

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    chamber: normalizeCommitteeChamber(row.chamber),
    state: row.state_code || undefined,
    // OpenStates files a state's own chamber orgs in this table; "upper"/"lower" only ever
    // appears on those, never on an actual committee.
    isChamberRecord: row.jurisdiction_type === "state"
      && (rawChamber === "upper" || rawChamber === "lower"),
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
