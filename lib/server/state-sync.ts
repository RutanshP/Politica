import { randomUUID } from "node:crypto";

import {
  fetchOpenStatesBills,
  fetchOpenStatesPeople,
  fetchOpenStatesVotes,
  isOpenStatesConfigured,
} from "@/lib/adapters/openstates";
import { slugifySegment } from "@/lib/utils";
import { upsertStoredBills } from "@/lib/supabase/bills";
import { upsertStoredCommittees } from "@/lib/supabase/committees";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";
import { replaceStoredVotes } from "@/lib/supabase/votes";
import type { BillRow, CommitteeRow, PoliticianRow, VotePositionRow, VoteRow } from "@/types/supabase";

function displayDate(value?: string) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export async function syncStateLegislationFromOpenStates(state = "ca") {
  if (!isOpenStatesConfigured()) {
    throw new Error("OpenStates API is not configured");
  }

  const [people, bills, votes] = await Promise.all([
    fetchOpenStatesPeople(state),
    fetchOpenStatesBills(state),
    fetchOpenStatesVotes(state),
  ]);

  const politicianRows: PoliticianRow[] = people.map((person) => {
    const name = person.name || "State Legislator";
    const title = person.current_role?.org_classification?.toLowerCase().includes("upper")
      ? "State Senator"
      : "State Representative";
    const id = person.id || `${state}-${slugifySegment(name)}`;

    return {
      id,
      slug: slugifySegment(name),
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
      source_id: id,
      jurisdiction_type: "state",
      state_code: state.toUpperCase(),
      session_id: null,
      synced_at: new Date().toISOString(),
      raw_payload: person,
      raw_member: person,
    };
  });

  const committeeMap = new Map<string, CommitteeRow>();
  const billRows: BillRow[] = bills.map((bill) => {
    const committeeName = bill.from_organization?.name || `${state.toUpperCase()} Legislature`;
    const committeeId = slugifySegment(`${state}-${committeeName}`);
    if (!committeeMap.has(committeeId)) {
      committeeMap.set(committeeId, {
        id: committeeId,
        slug: committeeId,
        name: committeeName,
        chamber: bill.from_organization?.classification || "State Legislature",
        jurisdiction: `${state.toUpperCase()} legislative activity`,
        chair: "Not available from configured sources",
        ranking_member: "Not available from configured sources",
        description: `Stored committee rollup synced from OpenStates for ${state.toUpperCase()}.`,
        hearing: "State hearing calendar not connected",
        active_bill_ids: [],
        member_ids: [],
        source: "openstates_sync",
        source_system: "openstates",
        source_id: committeeId,
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        session_id: null,
        synced_at: new Date().toISOString(),
        raw_payload: bill.from_organization,
        raw_committee: bill.from_organization,
      });
    }

    const id = bill.id || `${state}-${slugifySegment(bill.identifier || bill.title || randomUUID())}`;
    committeeMap.get(committeeId)?.active_bill_ids.push(id);

    return {
      id,
      slug: slugifySegment(`${state}-${bill.identifier || bill.title || id}`),
      number: bill.identifier || "State Bill",
      title: bill.title || "State legislation",
      summary: bill.abstracts?.[0]?.abstract || "Stored state bill record synced from OpenStates.",
      jurisdiction: "State",
      country: "United States",
      state: state.toUpperCase(),
      chamber: bill.from_organization?.classification || "State Legislature",
      status: "Introduced",
      topic: bill.subjects?.[0] || "State policy",
      sponsor_id: `${state}-sponsor-pending`,
      sponsor_name: "State sponsor data not normalized yet",
      committee_id: committeeId,
      committee_name: committeeName,
      latest_action: bill.latest_action_description || "Latest action unavailable",
      last_action_at: displayDate(bill.latest_action_date || bill.updated_at),
      introduced_at: displayDate(bill.created_at),
      session: `${state.toUpperCase()} Session`,
      chance_of_passing: 40,
      stats: {
        amendments: 0,
        cosponsors: 0,
        votes: 0,
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
      raw_payload: bill,
      raw_bill: bill,
    };
  });

  const voteRows: VoteRow[] = votes.map((vote) => {
    const yea = vote.counts?.find((item) => item.option?.toLowerCase() === "yes")?.value || 0;
    const nay = vote.counts?.find((item) => item.option?.toLowerCase() === "no")?.value || 0;
    const present = vote.counts?.find((item) => item.option?.toLowerCase() === "present")?.value || 0;
    const notVoting = vote.counts?.find((item) => item.option?.toLowerCase().includes("not"))?.value || 0;
    const voteId = vote.id || `${state}-${slugifySegment(vote.bill?.identifier || vote.motion_text || randomUUID())}`;

    return {
      id: voteId,
      bill_id: billRows.find((bill) => bill.number === vote.bill?.identifier)?.id || billRows[0]?.id || voteId,
      canonical_id: vote.id || null,
      bill_number: vote.bill?.identifier || "State Bill",
      title: vote.motion_text || "State vote",
      chamber: vote.organization?.classification || "State Legislature",
      date_label: displayDate(vote.start_date),
      result: vote.result || "Unknown",
      yea,
      nay,
      present,
      not_voting: notVoting,
      source_system: "openstates",
      source_id: vote.id || voteId,
      synced_at: new Date().toISOString(),
      raw_payload: vote,
    };
  });

  const votePositionRows: VotePositionRow[] = votes.flatMap((vote) => {
    const voteId = vote.id || `${state}-${slugifySegment(vote.bill?.identifier || vote.motion_text || randomUUID())}`;
    return (vote.votes ?? []).map((position) => ({
      vote_id: voteId,
      politician_id: position.voter_id || `${state}-${slugifySegment(position.voter_name || "member")}`,
      name: position.voter_name || "Unknown member",
      party: position.party || "Unknown",
      state: state.toUpperCase(),
      vote: position.option === "yes"
        ? "Yea"
        : position.option === "no"
          ? "Nay"
          : position.option === "present"
            ? "Present"
            : "Not Voting",
      source_system: "openstates",
      source_id: `${voteId}-${position.voter_id || slugifySegment(position.voter_name || "member")}`,
      synced_at: new Date().toISOString(),
      raw_payload: position,
    }));
  });

  await Promise.all([
    politicianRows.length > 0 ? upsertStoredPoliticians(politicianRows) : Promise.resolve([]),
    billRows.length > 0 ? upsertStoredBills(billRows) : Promise.resolve([]),
    committeeMap.size > 0 ? upsertStoredCommittees([...committeeMap.values()]) : Promise.resolve([]),
    replaceStoredVotes(voteRows.map((row) => row.id), voteRows, votePositionRows),
  ]);

  return {
    synced: politicianRows.length + billRows.length + committeeMap.size + voteRows.length,
    at: new Date().toISOString(),
  };
}
