import { randomUUID } from "node:crypto";

import {
  fetchOpenStatesBillDetail,
  fetchOpenStatesBills,
  fetchOpenStatesCommitteeDetail,
  fetchOpenStatesCommittees,
  fetchOpenStatesPeople,
  fetchOpenStatesVotes,
  isOpenStatesConfigured,
} from "@/lib/adapters/openstates";
import {
  appendStoredBillActions,
  appendStoredBillVersions,
  listStoredBillActionRowsByBillIds,
  listStoredBillVersionRowsByBillIds,
} from "@/lib/supabase/bills";
import { replaceStoredCommitteeMemberships } from "@/lib/supabase/committees";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { appendStoredVotes, fetchPoliticianVoteStatCounters, listStoredVoteHeaders } from "@/lib/supabase/votes";
import { applyBillSponsorStatDeltas, buildBillSponsorStatDeltas } from "@/lib/server/politician-stat-deltas";
import { applyVoteStatCountersToPoliticians, toVoteStatCounterMap } from "@/lib/server/vote-stats";
import { buildSourceFingerprint, classifyFreshness, normalizeSourceUpdatedAt } from "@/lib/server/sync-freshness";
import { normalizeChamber, normalizeOfficeTitle, normalizePersonLookup, normalizeStateLabel, slugifySegment } from "@/lib/utils";
import type {
  BillActionRow,
  BillRow,
  BillVersionRow,
  CommitteeMemberRow,
  CommitteeRow,
  PoliticianRow,
  VotePositionRow,
  VoteRow,
} from "@/types/supabase";
import type { OpenStatesBill, OpenStatesVote } from "@/types/openstates";

// Per-entity cap for a single state sync. People are capped separately: truncating the member
// list breaks roll-call matching, so it defaults to the full chamber.
const OPENSTATES_MAX_ROWS = Number(process.env.POLITICA_OPENSTATES_MAX_ROWS || 75);
const OPENSTATES_MAX_PEOPLE = Number(process.env.POLITICA_OPENSTATES_MAX_PEOPLE || 1000);
const OPENSTATES_DEFAULT_STATE_CODES = [
  "ca", "ny", "tx", "fl", "il", "pa", "oh", "ga", "mi", "nc",
] as const;

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function displayDate(value?: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function normalizeOpenStatesVoteOption(option?: string): VotePositionRow["vote"] {
  return option === "yes"
    ? "Yea"
    : option === "no"
      ? "Nay"
      : option === "present"
        ? "Present"
        : "Not Voting";
}

function normalizeOpenStatesActionType(classification?: string[]) {
  const values = (classification ?? []).join(" ").toLowerCase();
  if (values.includes("committee")) return "committee" as const;
  if (values.includes("passage") || values.includes("floor")) return "floor" as const;
  return "milestone" as const;
}

function normalizeOpenStatesStatus(bill: OpenStatesBill) {
  const latest = `${bill.latest_action_description || ""} ${(bill.classification ?? []).join(" ")}`.toLowerCase();
  if (latest.includes("signed") || latest.includes("chaptered")) return "Signed" as const;
  if (latest.includes("passed")) return "Passed Chamber" as const;
  if (latest.includes("committee")) return "In Committee" as const;
  if (latest.includes("fail")) return "Failed" as const;
  if (latest.includes("floor") || latest.includes("calendar")) return "On Floor" as const;
  return "Introduced" as const;
}

function getOpenStatesStateCodes() {
  const configured = process.env.POLITICA_OPENSTATES_STATE_CODES?.trim();
  if (!configured) {
    return [...OPENSTATES_DEFAULT_STATE_CODES];
  }

  return configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function buildOpenStatesBillFreshness(bill: OpenStatesBill) {
  return {
    sourceUpdatedAt: normalizeSourceUpdatedAt(bill.updated_at || bill.latest_action_date || bill.created_at),
    sourceFingerprint: buildSourceFingerprint({
      id: bill.id || null,
      identifier: bill.identifier || null,
      updated_at: bill.updated_at || null,
      latest_action_date: bill.latest_action_date || null,
      latest_action_description: bill.latest_action_description || null,
      title: bill.title || null,
      subjects: bill.subjects || [],
      from_organization: bill.from_organization || null,
      sponsorships: bill.sponsorships || [],
    }),
  };
}

function buildOpenStatesPersonFreshness(person: Awaited<ReturnType<typeof fetchOpenStatesPeople>>[number]) {
  return {
    sourceUpdatedAt: null,
    sourceFingerprint: buildSourceFingerprint({
      id: person.id || null,
      name: person.name || null,
      party: person.party || [],
      given_name: person.given_name || null,
      family_name: person.family_name || null,
      current_role: person.current_role || null,
      offices: person.offices || [],
      links: person.links || [],
    }),
  };
}

function buildOpenStatesCommitteeFingerprint(committee: Awaited<ReturnType<typeof fetchOpenStatesCommittees>>[number]) {
  return buildSourceFingerprint({
    id: committee.id || null,
    name: committee.name || null,
    classification: committee.classification || null,
    chamber: committee.chamber || null,
    members: committee.members || [],
    jurisdiction: committee.jurisdiction || null,
    links: committee.links || [],
  });
}

function buildSponsorFields(state: string, bill: OpenStatesBill) {
  const primarySponsor = bill.sponsorships?.find((item) => item.primary) || bill.sponsorships?.[0];
  const sponsorName = primarySponsor?.person?.name || primarySponsor?.name || "State sponsor unavailable";
  const sponsorId = primarySponsor?.person?.id || `${state}-${slugifySegment(sponsorName)}`;
  const cosponsorCount = Math.max((bill.sponsorships?.length || 1) - 1, 0);

  return {
    sponsorId,
    sponsorName,
    cosponsorCount,
  };
}

function buildStateVoteRows(
  state: string,
  vote: OpenStatesVote,
  linkedBillId: string | undefined,
): { voteRow: VoteRow; positionRows: VotePositionRow[] } {
  const yea = vote.counts?.find((item) => item.option?.toLowerCase() === "yes")?.value || 0;
  const nay = vote.counts?.find((item) => item.option?.toLowerCase() === "no")?.value || 0;
  const present = vote.counts?.find((item) => item.option?.toLowerCase() === "present")?.value || 0;
  const notVoting = vote.counts?.find((item) => item.option?.toLowerCase().includes("not"))?.value || 0;
  const voteId = vote.id || `${state}-${slugifySegment(vote.bill?.identifier || vote.motion_text || randomUUID())}`;

  return {
    voteRow: {
      id: voteId,
      bill_id: linkedBillId || voteId,
      canonical_id: vote.id || null,
      bill_number: vote.bill?.identifier || "State Bill",
      title: vote.motion_text || "State vote",
      // Kept in step with state-vote-sync: this writer stored the raw upper/lower classification
      // while the other mapped it, so the same table held two chamber vocabularies.
      chamber: normalizeChamber(vote.organization?.classification) || "State Legislature",
      jurisdiction_type: "state",
      state_code: state.toUpperCase(),
      date_label: displayDate(vote.start_date || vote.updated_at),
      result: vote.result || "Unknown",
      yea,
      nay,
      present,
      not_voting: notVoting,
      source_system: "openstates",
      source_id: vote.id || voteId,
      synced_at: new Date().toISOString(),
      raw_payload: vote,
    },
    positionRows: (vote.votes ?? []).map((position) => ({
      vote_id: voteId,
      politician_id: position.voter_id || `${state}-${slugifySegment(position.voter_name || "member")}`,
      name: position.voter_name || "Unknown member",
      party: position.party || "Unknown",
      state: state.toUpperCase(),
      vote: normalizeOpenStatesVoteOption(position.option),
      source_system: "openstates",
      source_id: `${voteId}-${position.voter_id || slugifySegment(position.voter_name || "member")}`,
      synced_at: new Date().toISOString(),
      raw_payload: position,
    })),
  };
}

export async function syncStateLegislationFromOpenStates(
  states: string | string[] = getOpenStatesStateCodes(),
  options?: { mode?: "incremental" | "full"; scope?: "people" | "detail" | "all" },
) {
  if (!isOpenStatesConfigured()) {
    throw new Error("OpenStates API is not configured");
  }

  const mode = options?.mode || "incremental";
  const scope = options?.scope || "all";
  const stateCodes = (Array.isArray(states) ? states : [states])
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const normalizedStateCodes = new Set(stateCodes.map((value) => value.toUpperCase()));
  const existingStateBillRows = await fetchSupabaseRows<BillRow>("bills", "jurisdiction_type=eq.state", {
    cache: "no-store",
    paginateAll: true,
  }).catch(() => []);
  const existingVoteRows = await fetchSupabaseRows<Pick<VoteRow, "bill_id">>("votes", undefined, {
    cache: "no-store",
    select: "bill_id",
    paginateAll: true,
  }).catch(() => []);
  const existingVoteHeaders = await listStoredVoteHeaders().catch(() => []);
  const existingPoliticianRows = await fetchSupabaseRows<PoliticianRow>("politicians", "jurisdiction_type=eq.state&order=id.asc", {
    cache: "no-store",
    paginateAll: true,
  }).catch(() => []);
  const existingCommitteeRows = await fetchSupabaseRows<CommitteeRow>("committees", "jurisdiction_type=eq.state&order=id.asc", {
    cache: "no-store",
    paginateAll: true,
  }).catch(() => []);
  const existingBillRowsById = new Map(existingStateBillRows.map((row) => [row.id, row]));
  const existingPoliticiansById = new Map(existingPoliticianRows.map((row) => [row.id, row]));
  const existingCommitteesById = new Map(existingCommitteeRows.map((row) => [row.id, row]));
  const existingVoteIds = new Set(existingVoteHeaders.map((row) => row.id));
  const existingVoteCanonicalIds = new Set(existingVoteHeaders.map((row) => row.canonical_id).filter(Boolean));

  const politicianMap = new Map<string, PoliticianRow>();
  const committeeMap = new Map<string, CommitteeRow>();
  const billMap = new Map<string, BillRow>();
  const voteMap = new Map<string, VoteRow>();
  const votePositionRows: VotePositionRow[] = [];
  const billActionRows: BillActionRow[] = [];
  const billVersionRows: BillVersionRow[] = [];
  const committeeMembershipRows: CommitteeMemberRow[] = [];
  const stateFailures: Array<{ state: string; error: string }> = [];
  let newBills = 0;
  let changedBills = 0;
  let unchangedBillsSkipped = 0;
  let newPoliticians = 0;
  let changedPoliticians = 0;
  let unchangedPoliticiansSkipped = 0;

  for (const state of stateCodes) {
    let people: Awaited<ReturnType<typeof fetchOpenStatesPeople>>;
    let bills: Awaited<ReturnType<typeof fetchOpenStatesBills>>;
    let committees: Awaited<ReturnType<typeof fetchOpenStatesCommittees>>;
    let votes: Awaited<ReturnType<typeof fetchOpenStatesVotes>>;

    try {
      // scope=people skips bills, committees and votes. Those paths fetch a detail document per
      // bill and per committee, and OpenStates allows 10 requests/minute -- so a full state sync
      // spends ~30 minutes on data the member directory does not need. Roll calls are imported
      // separately by state-vote-sync.
      //
      // scope=detail is the complement: bills, committees and (bill-embedded) votes, without
      // re-fetching people. Lets the cron run people daily (cheap) and detail on its own, slower
      // cadence -- both write against whatever politicians are already stored, via
      // existingPoliticiansById below, so people doesn't need to run in the same pass.
      if (scope === "people") {
        [people, bills, committees, votes] = [await fetchOpenStatesPeople(state), [], [], []];
      } else if (scope === "detail") {
        [bills, committees, votes] = await Promise.all([
          fetchOpenStatesBills(state),
          fetchOpenStatesCommittees(state),
          fetchOpenStatesVotes(state),
        ]);
        people = [];
      } else {
        [people, bills, committees, votes] = await Promise.all([
          fetchOpenStatesPeople(state),
          fetchOpenStatesBills(state),
          fetchOpenStatesCommittees(state),
          fetchOpenStatesVotes(state),
        ]);
      }
    } catch (error) {
      stateFailures.push({
        state,
        error: error instanceof Error ? error.message : "OpenStates sync failed",
      });
      continue;
    }

    people.slice(0, OPENSTATES_MAX_PEOPLE).forEach((person) => {
      const name = person.name || [person.given_name, person.family_name].filter(Boolean).join(" ") || "State Legislator";
      const stateName = normalizeStateLabel(state);
      const title = person.current_role?.org_classification?.toLowerCase().includes("upper")
        ? `${stateName} Senator`
        : `${stateName} Representative`;
      const id = person.id || `${state}-${slugifySegment(name)}`;
      const existing = existingPoliticiansById.get(id);
      const freshness = buildOpenStatesPersonFreshness(person);
      const classification = mode === "full"
        ? (existing ? "changed" : "new")
        : classifyFreshness(existing, freshness.sourceUpdatedAt, freshness.sourceFingerprint);

      if (classification === "unchanged") {
        unchangedPoliticiansSkipped += 1;
        return;
      }

      if (classification === "new") {
        newPoliticians += 1;
      } else {
        changedPoliticians += 1;
      }

      politicianMap.set(id, {
        id,
        slug: slugifySegment(`${state}-${name}`),
        name,
        title,
        party: person.party?.[0] || "Unknown",
        state: state.toUpperCase(),
        district: person.current_role?.district || null,
        biography: `${title} synced from OpenStates.`,
        born: person.birth_date || "Not available from configured sources",
        education: "Not available from configured sources",
        occupation: "Public official",
        // openstates_url is always present; links/offices only arrive when requested via
        // `include` (see fetchOpenStatesPeople), so fall back rather than storing a placeholder.
        website: person.links?.[0]?.url
          || person.openstates_url
          || "Not available from configured sources",
        office_phone: person.offices?.find((office) => office.voice)?.voice
          || "Not available from configured sources",
        office_address: person.offices?.find((office) => office.address)?.address
          || "Not available from configured sources",
        next_election: "State election feed not connected",
        stats: {
          votesWithParty: 0,
          votesAgainstParty: 0,
          attendance: 0,
          billsIntroduced: 0,
          billsPassed: 0,
          amendmentsOffered: 0,
          totalVotes: 0,
          castVotes: 0,
          withPartyCount: 0,
          againstPartyCount: 0,
        },
        ideology: {},
        source: "openstates_sync",
        source_system: "openstates",
        source_id: id,
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        session_id: null,
        source_updated_at: freshness.sourceUpdatedAt,
        source_fingerprint: freshness.sourceFingerprint,
        last_profile_synced_at: new Date().toISOString(),
        last_stats_recomputed_at: existing?.last_stats_recomputed_at || null,
        synced_at: new Date().toISOString(),
        raw_payload: person,
        raw_member: person,
      });
    });

    for (const committee of committees.slice(0, OPENSTATES_MAX_ROWS)) {
      const seedCommitteeName = committee.name || `${state.toUpperCase()} Legislature`;
      const seedCommitteeId = `${state}-${committee.id || slugifySegment(seedCommitteeName)}`;
      const existingCommittee = existingCommitteesById.get(seedCommitteeId);
      const seedFingerprint = buildOpenStatesCommitteeFingerprint(committee);
      const existingCommitteeFingerprint = existingCommittee
        ? buildSourceFingerprint(existingCommittee.raw_committee || existingCommittee.raw_payload || {})
        : null;
      if (mode !== "full" && existingCommittee && existingCommitteeFingerprint === seedFingerprint) {
        continue;
      }

      let detail = committee;
      if (committee.id) {
        detail = await fetchOpenStatesCommitteeDetail(committee.id).catch(() => committee);
      }

      const committeeName = detail.name || `${state.toUpperCase()} Legislature`;
      const committeeId = `${state}-${detail.id || slugifySegment(committeeName)}`;
      const committeeSlug = slugifySegment(`${state}-${committeeName}-${committeeId}`);
      const members = detail.members ?? [];
      const chair = members.find((member) => /chair/i.test(member.role || ""))?.name || "Not available from configured sources";
      const rankingMember = members.find((member) => /vice|ranking/i.test(member.role || ""))?.name || "Not available from configured sources";

      committeeMap.set(committeeId, {
        id: committeeId,
        slug: committeeSlug,
        name: committeeName,
        chamber: detail.classification || detail.chamber || "State Legislature",
        jurisdiction: detail.jurisdiction?.name || `${state.toUpperCase()} legislative activity`,
        chair,
        ranking_member: rankingMember,
        description: `Stored committee record synced from OpenStates for ${state.toUpperCase()}.`,
        hearing: "State hearing calendar not connected",
        active_bill_ids: committeeMap.get(committeeId)?.active_bill_ids || [],
        member_ids: members.map((member) => member.person_id).filter((value): value is string => Boolean(value)),
        contact_url: detail.links?.[0]?.url || null,
        contact_phone: null,
        contact_address: null,
        subcommittees: [],
        source: "openstates_sync",
        source_system: "openstates",
        source_id: committeeId,
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        session_id: null,
        synced_at: new Date().toISOString(),
        raw_payload: detail,
        raw_committee: detail,
      });

      members.forEach((member, index) => {
        if (!member.person_id) {
          return;
        }
        committeeMembershipRows.push({
          committee_id: committeeId,
          politician_id: member.person_id,
          role: member.role || "member",
          sort_order: index,
          source_system: "openstates",
          source_id: `${committeeId}:${member.person_id}`,
          synced_at: new Date().toISOString(),
          raw_payload: member,
        });
      });
    }

    for (const listBill of bills.slice(0, OPENSTATES_MAX_ROWS)) {
      const seedId = listBill.id || `${state}-${slugifySegment(listBill.identifier || listBill.title || randomUUID())}`;
      const existingBill = existingBillRowsById.get(seedId);
      const seedFreshness = buildOpenStatesBillFreshness(listBill);
      const initialClassification = mode === "full"
        ? (existingBill ? "changed" : "new")
        : classifyFreshness(existingBill, seedFreshness.sourceUpdatedAt, seedFreshness.sourceFingerprint);
      if (initialClassification === "unchanged" && existingBill) {
        unchangedBillsSkipped += 1;
        continue;
      }

      const detail = listBill.id
        ? await fetchOpenStatesBillDetail(listBill.id).catch(() => listBill)
        : listBill;
      const freshness = buildOpenStatesBillFreshness(detail);
      const classification = mode === "full"
        ? (existingBill ? "changed" : "new")
        : classifyFreshness(existingBill, freshness.sourceUpdatedAt, freshness.sourceFingerprint);
      if (classification === "unchanged" && existingBill) {
        unchangedBillsSkipped += 1;
        continue;
      }
      if (classification === "new") {
        newBills += 1;
      } else {
        changedBills += 1;
      }
      const committeeName = detail.from_organization?.name || `${state.toUpperCase()} Legislature`;
      const committeeId = `${state}-${detail.from_organization?.name ? detail.from_organization.name : slugifySegment(committeeName)}`;
      const sponsorFields = buildSponsorFields(state, detail);

      if (!committeeMap.has(committeeId)) {
        committeeMap.set(committeeId, {
          id: committeeId,
          slug: slugifySegment(`${state}-${committeeName}-${committeeId}`),
          name: committeeName,
          chamber: detail.from_organization?.classification || "State Legislature",
          jurisdiction: `${state.toUpperCase()} legislative activity`,
          chair: "Not available from configured sources",
          ranking_member: "Not available from configured sources",
          description: `Stored committee rollup synced from OpenStates for ${state.toUpperCase()}.`,
          hearing: "State hearing calendar not connected",
          active_bill_ids: [],
          member_ids: [],
          contact_url: null,
          contact_phone: null,
          contact_address: null,
          subcommittees: [],
          source: "openstates_sync",
          source_system: "openstates",
          source_id: committeeId,
          jurisdiction_type: "state",
          state_code: state.toUpperCase(),
          session_id: null,
          synced_at: new Date().toISOString(),
          raw_payload: detail.from_organization,
          raw_committee: detail.from_organization,
        });
      }

      const id = detail.id || `${state}-${slugifySegment(detail.identifier || detail.title || randomUUID())}`;
      const committeeRow = committeeMap.get(committeeId);
      if (committeeRow && !committeeRow.active_bill_ids.includes(id)) {
        committeeRow.active_bill_ids.push(id);
      }

      const existingSponsor = politicianMap.get(sponsorFields.sponsorId) || existingPoliticiansById.get(sponsorFields.sponsorId);
      if (!politicianMap.has(sponsorFields.sponsorId) && existingSponsor) {
        politicianMap.set(sponsorFields.sponsorId, existingSponsor);
      }
      if (!existingSponsor && sponsorFields.sponsorName) {
        politicianMap.set(sponsorFields.sponsorId, {
          id: sponsorFields.sponsorId,
          slug: slugifySegment(`${state}-${sponsorFields.sponsorName}`),
          name: sponsorFields.sponsorName,
          title: normalizeOfficeTitle("State Legislator", {
            jurisdictionType: "state",
            state,
          }),
          party: "Unknown",
          state: state.toUpperCase(),
          district: null,
          biography: "Placeholder state legislator record created from OpenStates sponsorship data.",
          born: "Not available from configured sources",
          education: "Not available from configured sources",
          occupation: "Public official",
          website: "Not available from configured sources",
          office_phone: "Not available from configured sources",
          office_address: "Not available from configured sources",
          next_election: "State election feed not connected",
          stats: {
            votesWithParty: 0,
            votesAgainstParty: 0,
            attendance: 0,
            billsIntroduced: 0,
            billsPassed: 0,
            amendmentsOffered: 0,
            totalVotes: 0,
            castVotes: 0,
            withPartyCount: 0,
            againstPartyCount: 0,
          },
          ideology: {},
          source: "openstates_sync",
          source_system: "openstates",
          source_id: sponsorFields.sponsorId,
          jurisdiction_type: "state",
          state_code: state.toUpperCase(),
          session_id: null,
          source_updated_at: null,
          source_fingerprint: null,
          last_profile_synced_at: null,
          last_stats_recomputed_at: null,
          synced_at: new Date().toISOString(),
          raw_payload: detail.sponsorships?.[0] || detail,
          raw_member: detail.sponsorships?.[0] || detail,
        });
      }

      billMap.set(id, {
        id,
        slug: slugifySegment(`${state}-${detail.identifier || detail.title || id}`),
        number: detail.identifier || "State Bill",
        title: detail.title || detail.other_titles?.[0]?.title || "State legislation",
        summary: detail.abstracts?.[0]?.abstract || "Stored state bill record synced from OpenStates.",
        jurisdiction: "State",
        country: "United States",
        state: state.toUpperCase(),
        chamber: detail.from_organization?.classification || "State Legislature",
        status: normalizeOpenStatesStatus(detail),
        topic: detail.subjects?.[0] || "State policy",
        sponsor_id: sponsorFields.sponsorId,
        sponsor_name: sponsorFields.sponsorName,
        committee_id: committeeId,
        committee_name: committeeName,
        latest_action: detail.latest_action_description || "Latest action unavailable",
        last_action_at: displayDate(detail.latest_action_date || detail.updated_at),
        introduced_at: displayDate(detail.created_at || detail.first_action_date),
        session: `${state.toUpperCase()} Session`,
        chance_of_passing: 40,
        stats: {
          amendments: 0,
          cosponsors: sponsorFields.cosponsorCount,
          votes: detail.votes?.length || 0,
          bipartisanScore: 0,
        },
        related_bill_ids: [],
        source: "openstates_sync",
        source_system: "openstates",
        source_id: id,
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        session_id: null,
        source_updated_at: freshness.sourceUpdatedAt,
        source_fingerprint: freshness.sourceFingerprint,
        last_detail_synced_at: new Date().toISOString(),
        last_actions_synced_at: new Date().toISOString(),
        last_versions_synced_at: new Date().toISOString(),
        last_votes_synced_at: null,
        synced_at: new Date().toISOString(),
        raw_payload: detail,
        raw_bill: detail,
      });

      (detail.actions ?? []).forEach((action, index) => {
        billActionRows.push({
          bill_id: id,
          sort_order: index,
          date: displayDate(action.date),
          label: action.organization?.name || action.classification?.[0] || "Action",
          detail: action.description || "No stored action detail",
          type: normalizeOpenStatesActionType(action.classification),
        });
      });

      (detail.documents ?? []).forEach((document, index) => {
        const formats = (document.links ?? [])
          .filter((link): link is { media_type?: string; url: string } => Boolean(link?.url))
          .map((link) => ({
            type: link.media_type || "Document",
            url: link.url,
          }));

        billVersionRows.push({
          bill_id: id,
          version_id: `${id}-document-${index + 1}`,
          sort_order: index,
          label: document.note || `Version ${index + 1}`,
          date: displayDate(document.date),
          type: document.note || "Document",
          content: [
            "Official state bill document metadata synced from OpenStates.",
            ...formats.map((format) => `${format.type}: ${format.url}`),
          ],
          source_url: formats[0]?.url || null,
          formats,
          is_full_text_available: false,
        });
      });

      (detail.votes ?? []).forEach((vote) => {
        const { voteRow, positionRows } = buildStateVoteRows(state, vote, id);
        if (existingVoteIds.has(voteRow.id) || (voteRow.canonical_id && existingVoteCanonicalIds.has(voteRow.canonical_id))) {
          return;
        }
        voteMap.set(voteRow.id, voteRow);
        votePositionRows.push(...positionRows);
      });
    }

    votes.slice(0, OPENSTATES_MAX_ROWS).forEach((vote) => {
      const linkedBill = [...billMap.values()].find((billRow) =>
        billRow.state === state.toUpperCase() && billRow.number === vote.bill?.identifier);
      const { voteRow, positionRows } = buildStateVoteRows(state, vote, linkedBill?.id);
      if (existingVoteIds.has(voteRow.id) || (voteRow.canonical_id && existingVoteCanonicalIds.has(voteRow.canonical_id))) {
        return;
      }
      voteMap.set(voteRow.id, voteRow);
      votePositionRows.push(...positionRows);
    });
  }

  const uniqueVotePositionRows = votePositionRows.filter((row, index, items) =>
    items.findIndex((candidate) => candidate.vote_id === row.vote_id && candidate.politician_id === row.politician_id) === index);
  const affectedPoliticianIdsFromVotes = [...new Set(uniqueVotePositionRows.map((row) => row.politician_id))];
  affectedPoliticianIdsFromVotes.forEach((politicianId) => {
    if (!politicianMap.has(politicianId) && existingPoliticiansById.has(politicianId)) {
      politicianMap.set(politicianId, existingPoliticiansById.get(politicianId)!);
    }
  });
  const billRows = [...billMap.values()];
  const voteRows = [...voteMap.values()];
  const committeeRows = [...committeeMap.values()].map((committee) => ({
    ...committee,
    member_ids: committeeMembershipRows
      .filter((row) => row.committee_id === committee.id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((row) => row.politician_id),
  }));
  const activeStateBillIds = new Set(billRows.map((row) => row.id));
  const voteBackedBillIds = new Set(existingVoteRows.map((row) => row.bill_id));
  const staleStateBillIds = mode === "full"
    ? existingStateBillRows
    .filter((row) =>
      row.jurisdiction_type === "state"
      && normalizedStateCodes.has((row.state_code || row.state || "").toUpperCase())
      && (row.source_system || "").toLowerCase() === "openstates"
      && !activeStateBillIds.has(row.id)
      && !voteBackedBillIds.has(row.id))
    .map((row) => row.id)
    : [];
  const removedBillRowsForStats = staleStateBillIds
    .map((billId) => existingBillRowsById.get(billId))
    .filter((row): row is BillRow => Boolean(row));
  const politicianRowsById = new Map<string, PoliticianRow>();
  [...politicianMap.values()].forEach((row) => {
    politicianRowsById.set(row.id, row);
  });
  // The recompute below covers every affected member, so a separate "missing counters" backfill
  // pass -- which pulled each member's full position history into the app -- is no longer needed.
  // Assigned from stored positions rather than incremented; see applyVoteStatCountersToPoliticians.
  const voteUpdatedRows = applyVoteStatCountersToPoliticians(
    affectedPoliticianIdsFromVotes
      .map((politicianId) => politicianRowsById.get(politicianId))
      .filter((row): row is PoliticianRow => Boolean(row)),
    toVoteStatCounterMap(
      await fetchPoliticianVoteStatCounters(affectedPoliticianIdsFromVotes).catch(() => []),
    ),
  );
  voteUpdatedRows.forEach((row) => {
    politicianRowsById.set(row.id, row);
  });
  const billSponsorStatDeltas = buildBillSponsorStatDeltas(
    existingStateBillRows,
    billRows,
    removedBillRowsForStats,
  );
  [...billSponsorStatDeltas.keys()].forEach((politicianId) => {
    if (!politicianRowsById.has(politicianId) && existingPoliticiansById.has(politicianId)) {
      politicianRowsById.set(politicianId, existingPoliticiansById.get(politicianId)!);
    }
  });
  const finalizedPoliticianRows = applyBillSponsorStatDeltas(
    [...politicianRowsById.values()],
    billSponsorStatDeltas,
  ).filter((row) =>
    politicianMap.has(row.id)
    || affectedPoliticianIdsFromVotes.includes(row.id)
    || billSponsorStatDeltas.has(row.id));
  const changedBillIds = billRows.map((row) => row.id);
  const changedCommitteeIds = committeeRows.map((row) => row.id);
  const existingActionRows = await listStoredBillActionRowsByBillIds(changedBillIds);
  const existingActionSignaturesByBillId = new Map<string, Set<string>>();
  const nextActionSortOrderByBillId = new Map<string, number>();
  existingActionRows.forEach((row) => {
    const signatures = existingActionSignaturesByBillId.get(row.bill_id) || new Set<string>();
    signatures.add(`${row.date}|${row.label}|${row.detail}|${row.type}`);
    existingActionSignaturesByBillId.set(row.bill_id, signatures);
    nextActionSortOrderByBillId.set(row.bill_id, Math.max(nextActionSortOrderByBillId.get(row.bill_id) || 0, row.sort_order + 1));
  });
  const appendedActionRows = billActionRows.flatMap((row) => {
    const signatures = existingActionSignaturesByBillId.get(row.bill_id) || new Set<string>();
    const signature = `${row.date}|${row.label}|${row.detail}|${row.type}`;
    if (signatures.has(signature)) {
      return [];
    }
    const sortOrder = nextActionSortOrderByBillId.get(row.bill_id) || 0;
    nextActionSortOrderByBillId.set(row.bill_id, sortOrder + 1);
    signatures.add(signature);
    existingActionSignaturesByBillId.set(row.bill_id, signatures);
    return [{ ...row, sort_order: sortOrder }];
  });

  const existingVersionRows = await listStoredBillVersionRowsByBillIds(changedBillIds);
  const existingVersionIdsByBillId = new Map<string, Set<string>>();
  existingVersionRows.forEach((row) => {
    const ids = existingVersionIdsByBillId.get(row.bill_id) || new Set<string>();
    ids.add(row.version_id);
    existingVersionIdsByBillId.set(row.bill_id, ids);
  });
  const appendedVersionRows = billVersionRows.filter((row) => {
    const ids = existingVersionIdsByBillId.get(row.bill_id) || new Set<string>();
    if (ids.has(row.version_id)) {
      return false;
    }
    ids.add(row.version_id);
    existingVersionIdsByBillId.set(row.bill_id, ids);
    return true;
  });

  await Promise.all([
    finalizedPoliticianRows.length > 0
      ? upsertSupabaseRowsInChunks("politicians", finalizedPoliticianRows, "id", 25)
      : Promise.resolve([]),
    billRows.length > 0
      ? upsertSupabaseRowsInChunks("bills", billRows, "id", 25)
      : Promise.resolve([]),
    committeeRows.length > 0
      ? upsertSupabaseRowsInChunks("committees", committeeRows, "id", 25)
      : Promise.resolve([]),
    changedCommitteeIds.length > 0
      ? replaceStoredCommitteeMemberships(changedCommitteeIds, committeeMembershipRows.filter((row) => changedCommitteeIds.includes(row.committee_id)))
      : Promise.resolve([]),
    appendedActionRows.length > 0
      ? appendStoredBillActions(appendedActionRows)
      : Promise.resolve([]),
    appendedVersionRows.length > 0
      ? appendStoredBillVersions(appendedVersionRows)
      : Promise.resolve([]),
    voteRows.length > 0
      ? appendStoredVotes(voteRows, uniqueVotePositionRows)
      : Promise.resolve([]),
  ]);

  if (staleStateBillIds.length > 0) {
    for (let index = 0; index < staleStateBillIds.length; index += 100) {
      const chunk = staleStateBillIds.slice(index, index + 100);
      const filter = buildQuotedInFilter(chunk);
      await deleteSupabaseRows("bill_actions", `bill_id=in.(${filter})`);
      await deleteSupabaseRows("bill_versions", `bill_id=in.(${filter})`);
      await deleteSupabaseRows("bills", `id=in.(${filter})`);
    }
  }

  if (politicianMap.size === 0 && billMap.size === 0 && committeeMap.size === 0 && stateFailures.length > 0) {
    const detail = stateFailures[0]?.error || "OpenStates sync produced no records";
    throw new Error(detail);
  }

  return {
    synced: finalizedPoliticianRows.length + billRows.length + committeeRows.length + voteRows.length,
    mode,
    newBills,
    changedBills,
    unchangedBillsSkipped,
    newPoliticians,
    changedPoliticians,
    unchangedPoliticiansSkipped,
    newActionsAppended: appendedActionRows.length,
    newVersionsAppended: appendedVersionRows.length,
    newVotesAppended: voteRows.length,
    derivedPoliticiansRecomputed: finalizedPoliticianRows.length,
    staleBillsDeleted: staleStateBillIds.length,
    statesSynced: stateCodes.length,
    stateFailures,
    at: new Date().toISOString(),
  };
}
