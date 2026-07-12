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
import { replaceStoredBillActions, replaceStoredBillVersions } from "@/lib/supabase/bills";
import { replaceStoredCommitteeMemberships } from "@/lib/supabase/committees";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { replaceStoredVotes } from "@/lib/supabase/votes";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { normalizeOfficeTitle, normalizePersonLookup, normalizeStateLabel, slugifySegment } from "@/lib/utils";
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

const OPENSTATES_MAX_ROWS = 75;
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
      chamber: vote.organization?.classification || "State Legislature",
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

export async function syncStateLegislationFromOpenStates(states: string | string[] = getOpenStatesStateCodes()) {
  if (!isOpenStatesConfigured()) {
    throw new Error("OpenStates API is not configured");
  }

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

  const politicianMap = new Map<string, PoliticianRow>();
  const committeeMap = new Map<string, CommitteeRow>();
  const billMap = new Map<string, BillRow>();
  const voteMap = new Map<string, VoteRow>();
  const votePositionRows: VotePositionRow[] = [];
  const billActionRows: BillActionRow[] = [];
  const billVersionRows: BillVersionRow[] = [];
  const committeeMembershipRows: CommitteeMemberRow[] = [];
  const stateFailures: Array<{ state: string; error: string }> = [];

  for (const state of stateCodes) {
    let people;
    let bills;
    let committees;
    let votes;

    try {
      [people, bills, committees, votes] = await Promise.all([
        fetchOpenStatesPeople(state),
        fetchOpenStatesBills(state),
        fetchOpenStatesCommittees(state),
        fetchOpenStatesVotes(state),
      ]);
    } catch (error) {
      stateFailures.push({
        state,
        error: error instanceof Error ? error.message : "OpenStates sync failed",
      });
      continue;
    }

    people.slice(0, OPENSTATES_MAX_ROWS).forEach((person) => {
      const name = person.name || [person.given_name, person.family_name].filter(Boolean).join(" ") || "State Legislator";
      const stateName = normalizeStateLabel(state);
      const title = person.current_role?.org_classification?.toLowerCase().includes("upper")
        ? `${stateName} Senator`
        : `${stateName} Representative`;
      const id = person.id || `${state}-${slugifySegment(name)}`;

      politicianMap.set(id, {
        id,
        slug: slugifySegment(`${state}-${name}`),
        name,
        title,
        party: person.party?.[0] || "Unknown",
        state: state.toUpperCase(),
        district: person.current_role?.district || null,
        biography: `${title} synced from OpenStates.`,
        born: "Not available from configured sources",
        education: "Not available from configured sources",
        occupation: "Public official",
        website: person.links?.[0]?.url || "Not available from configured sources",
        office_phone: person.offices?.[0]?.voice || "Not available from configured sources",
        office_address: person.offices?.[0]?.address || "Not available from configured sources",
        next_election: "State election feed not connected",
        stats: {
          votesWithParty: 0,
          votesAgainstParty: 0,
          attendance: 0,
          billsIntroduced: 0,
          billsPassed: 0,
          amendmentsOffered: 0,
        },
        ideology: {},
        source: "openstates_sync",
        source_system: "openstates",
        source_id: id,
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        session_id: null,
        synced_at: new Date().toISOString(),
        raw_payload: person,
        raw_member: person,
      });
    });

    for (const committee of committees.slice(0, OPENSTATES_MAX_ROWS)) {
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
      const detail = listBill.id
        ? await fetchOpenStatesBillDetail(listBill.id).catch(() => listBill)
        : listBill;
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

      const existingSponsor = politicianMap.get(sponsorFields.sponsorId);
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
          },
          ideology: {},
          source: "openstates_sync",
          source_system: "openstates",
          source_id: sponsorFields.sponsorId,
          jurisdiction_type: "state",
          state_code: state.toUpperCase(),
          session_id: null,
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
        voteMap.set(voteRow.id, voteRow);
        votePositionRows.push(...positionRows);
      });
    }

    votes.slice(0, OPENSTATES_MAX_ROWS).forEach((vote) => {
      const linkedBill = [...billMap.values()].find((billRow) =>
        billRow.state === state.toUpperCase() && billRow.number === vote.bill?.identifier);
      const { voteRow, positionRows } = buildStateVoteRows(state, vote, linkedBill?.id);
      voteMap.set(voteRow.id, voteRow);
      votePositionRows.push(...positionRows);
    });
  }

  const uniqueVotePositionRows = votePositionRows.filter((row, index, items) =>
    items.findIndex((candidate) => candidate.vote_id === row.vote_id && candidate.politician_id === row.politician_id) === index);
  const basePoliticianRows = [...politicianMap.values()];
  const updatedPoliticianRows = buildUpdatedPoliticianRowsFromVotePositions(basePoliticianRows, uniqueVotePositionRows);
  const updatedPoliticianMap = new Map(updatedPoliticianRows.map((row) => [row.id, row]));
  const politicianRows = basePoliticianRows.map((row) => updatedPoliticianMap.get(row.id) || row);

  const sponsoredBillCounts = new Map<string, number>();
  const passedBillCounts = new Map<string, number>();
  [...billMap.values()].forEach((bill) => {
    sponsoredBillCounts.set(bill.sponsor_id, (sponsoredBillCounts.get(bill.sponsor_id) || 0) + 1);
    if (bill.status === "Passed Chamber" || bill.status === "Signed") {
      passedBillCounts.set(bill.sponsor_id, (passedBillCounts.get(bill.sponsor_id) || 0) + 1);
    }
  });
  const finalizedPoliticianRows = politicianRows.map((row) => ({
    ...row,
    stats: {
      ...row.stats,
      billsIntroduced: sponsoredBillCounts.get(row.id) || row.stats.billsIntroduced,
      billsPassed: passedBillCounts.get(row.id) || row.stats.billsPassed,
    },
  }));

  const billRows = [...billMap.values()];
  const voteRows = [...voteMap.values()];
  const committeeRows = [...committeeMap.values()].map((committee) => ({
    ...committee,
    member_ids: committeeMembershipRows
      .filter((row) => row.committee_id === committee.id)
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((row) => row.politician_id),
  }));

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
    replaceStoredCommitteeMemberships(committeeRows.map((row) => row.id), committeeMembershipRows),
    replaceStoredBillActions(billRows.map((row) => row.id), billActionRows),
    replaceStoredBillVersions(billRows.map((row) => row.id), billVersionRows),
    replaceStoredVotes(voteRows.map((row) => row.id), voteRows, uniqueVotePositionRows),
  ]);

  const activeStateBillIds = new Set(billRows.map((row) => row.id));
  const voteBackedBillIds = new Set(existingVoteRows.map((row) => row.bill_id));
  const staleStateBillIds = existingStateBillRows
    .filter((row) =>
      row.jurisdiction_type === "state"
      && normalizedStateCodes.has((row.state_code || row.state || "").toUpperCase())
      && (row.source_system || "").toLowerCase() === "openstates"
      && !activeStateBillIds.has(row.id)
      && !voteBackedBillIds.has(row.id))
    .map((row) => row.id);

  if (staleStateBillIds.length > 0) {
    for (let index = 0; index < staleStateBillIds.length; index += 100) {
      const chunk = staleStateBillIds.slice(index, index + 100);
      const filter = buildQuotedInFilter(chunk);
      await deleteSupabaseRows("bill_actions", `bill_id=in.(${filter})`);
      await deleteSupabaseRows("bill_versions", `bill_id=in.(${filter})`);
      await deleteSupabaseRows("bills", `id=in.(${filter})`);
    }
  }

  if (politicianMap.size === 0 && billMap.size === 0 && committeeMap.size === 0) {
    const detail = stateFailures[0]?.error || "OpenStates sync produced no records";
    throw new Error(detail);
  }

  return {
    synced: finalizedPoliticianRows.length + billRows.length + committeeRows.length + voteRows.length,
    staleBillsDeleted: staleStateBillIds.length,
    statesSynced: stateCodes.length,
    stateFailures,
    at: new Date().toISOString(),
  };
}
