import { fetchOpenStatesBillsWithVotes } from "@/lib/adapters/openstates";
import { appendStoredVotes } from "@/lib/supabase/votes";
import { fetchSupabaseRows } from "@/lib/supabase/rest";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { normalizeChamber, normalizePersonLookup } from "@/lib/utils";
import type { OpenStatesBill, OpenStatesVote } from "@/types/openstates";
import type { PoliticianRow, VotePositionRow, VoteRow } from "@/types/supabase";

/**
 * Imports state roll-call votes so state legislators have attendance and party-alignment.
 *
 * Two things make this harder than the federal path:
 *
 *  1. OpenStates roll calls carry no voter_id -- every entry is just a chamber surname
 *     ("Alders", "Bell, C.", "Mr. Speaker(C)"). buildStateVoteRows keyed positions on
 *     `position.voter_id`, which is always undefined, so every position would be stranded on a
 *     synthetic id and no member would ever get stats. We match the surname against the members
 *     we already store, scoped to the same state and chamber.
 *
 *  2. Roll-call entries carry no party either, so party alignment is impossible from the payload
 *     alone. We take the party from the matched member, which is what makes votesWithParty /
 *     votesAgainstParty computable at all.
 *
 * Attendance does not depend on bills existing: a vote row is stored per roll call whether or not
 * the bill itself was imported.
 */

interface StateVoteSyncResult {
  state: string;
  billsScanned: number;
  votesImported: number;
  positionsMatched: number;
  positionsUnmatched: number;
  politiciansUpdated: number;
  unmatchedNames: string[];
}

function displayDate(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function normalizeVoteOption(option?: string): VotePositionRow["vote"] {
  const normalized = (option || "").trim().toLowerCase();
  if (normalized === "yes") return "Yea";
  if (normalized === "no") return "Nay";
  if (normalized.includes("absent") || normalized.includes("not voting") || normalized.includes("excused")) {
    return "Not Voting";
  }
  return "Present";
}

/** "Bell, C." -> { surname: "bell", initial: "c" };  "Mr. Speaker(C)" -> null */
function parseVoterName(voterName?: string) {
  const cleaned = (voterName || "")
    .replace(/\([^)]*\)/g, " ")      // trailing "(C)" chair markers
    .replace(/\b(mr|mrs|ms|dr)\.?\s+speaker\b/gi, " ")
    .trim();

  if (!cleaned) return null;

  const [surnamePart, initialPart] = cleaned.split(",");
  const surname = normalizePersonLookup(surnamePart);
  if (!surname) return null;

  const initial = normalizePersonLookup(initialPart || "").replace(/[^a-z]/g, "").charAt(0) || "";
  return { surname, initial };
}

function chamberOf(vote: OpenStatesVote) {
  const classification = (vote.organization?.classification || "").toLowerCase();
  if (classification.includes("upper") || classification.includes("senate")) return "upper";
  if (classification.includes("lower") || classification.includes("house") || classification.includes("assembly")) {
    return "lower";
  }
  return "";
}

function chamberOfPolitician(row: PoliticianRow) {
  const rawMember = (row.raw_member ?? {}) as { current_role?: { org_classification?: string } };
  const classification = (rawMember.current_role?.org_classification || "").toLowerCase();
  if (classification) return classification;

  const title = (row.title || "").toLowerCase();
  if (title.includes("senator")) return "upper";
  if (title.includes("representative") || title.includes("delegate") || title.includes("assembly")) return "lower";
  return "";
}

/** surname (and chamber) -> candidate members, so "Bell, C." can be disambiguated by initial. */
function buildStateMemberLookup(rows: PoliticianRow[]) {
  const byChamberSurname = new Map<string, PoliticianRow[]>();

  for (const row of rows) {
    const rawMember = (row.raw_member ?? {}) as { family_name?: string; given_name?: string; name?: string };
    const surnameSource = rawMember.family_name
      || (row.name || "").trim().split(/\s+/).at(-1)
      || "";
    const surname = normalizePersonLookup(surnameSource);
    if (!surname) continue;

    const key = `${chamberOfPolitician(row)}|${surname}`;
    byChamberSurname.set(key, [...(byChamberSurname.get(key) || []), row]);
  }

  return byChamberSurname;
}

function givenInitial(row: PoliticianRow) {
  const rawMember = (row.raw_member ?? {}) as { given_name?: string };
  const given = normalizePersonLookup(rawMember.given_name || row.name || "");
  return given.charAt(0);
}

function matchVoter(
  voterName: string | undefined,
  chamber: string,
  lookup: ReturnType<typeof buildStateMemberLookup>,
) {
  const parsed = parseVoterName(voterName);
  if (!parsed) return undefined;

  const candidates = lookup.get(`${chamber}|${parsed.surname}`) || [];
  if (candidates.length === 1) {
    return candidates[0];
  }

  if (candidates.length > 1 && parsed.initial) {
    const byInitial = candidates.filter((row) => givenInitial(row) === parsed.initial);
    if (byInitial.length === 1) {
      return byInitial[0];
    }
  }

  // Ambiguous surname with no usable initial: attributing the vote to the wrong member would
  // silently corrupt their attendance, so drop it rather than guess.
  return undefined;
}

export async function syncStateVotesFromOpenStates(options: { state: string; dryRun?: boolean }): Promise<StateVoteSyncResult> {
  const state = options.state.toLowerCase();

  const politicianRows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    `jurisdiction_type=eq.state&state_code=eq.${state.toUpperCase()}&order=id.asc`,
    {
      cache: "no-store",
      paginateAll: true,
      select: "id,slug,name,title,party,state,district,biography,born,education,occupation,website,office_phone,office_address,next_election,stats,ideology,source,source_system,source_id,jurisdiction_type,state_code,session_id,synced_at,raw_member",
    },
  );

  const lookup = buildStateMemberLookup(politicianRows);
  const bills = await fetchOpenStatesBillsWithVotes(state);

  // Only reference a bill we actually store; votes.bill_id keeps its foreign key, it is merely
  // nullable now.
  const billIds = bills.map((bill) => bill.id).filter((id): id is string => Boolean(id));
  const storedBillRows = billIds.length > 0
    ? await fetchSupabaseRows<{ id: string }>(
        "bills",
        `id=in.(${billIds.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",")})`,
        { cache: "no-store", select: "id" },
      ).catch(() => [])
    : [];
  const storedBillIds = new Set(storedBillRows.map((row) => row.id));

  const voteRows: VoteRow[] = [];
  const positionRows: VotePositionRow[] = [];
  const unmatched = new Map<string, number>();
  const now = new Date().toISOString();

  for (const bill of bills as OpenStatesBill[]) {
    for (const vote of bill.votes ?? []) {
      const voteId = vote.id;
      const roll = vote.votes ?? [];
      if (!voteId || roll.length === 0) {
        continue;
      }

      const chamber = chamberOf(vote);
      const matched: VotePositionRow[] = [];

      for (const entry of roll) {
        const member = matchVoter(entry.voter_name, chamber, lookup);
        if (!member) {
          const name = (entry.voter_name || "").trim();
          if (name) unmatched.set(name, (unmatched.get(name) || 0) + 1);
          continue;
        }

        matched.push({
          vote_id: voteId,
          politician_id: member.id,
          name: entry.voter_name || member.name,
          // The roll call carries no party; take it from the member so alignment is computable.
          party: member.party,
          state: state.toUpperCase(),
          vote: normalizeVoteOption(entry.option),
          source_system: "openstates",
          source_id: `${voteId}-${member.id}`,
          synced_at: now,
          raw_payload: entry,
        });
      }

      if (matched.length === 0) {
        continue;
      }

      const count = (option: string) =>
        vote.counts?.find((item) => (item.option || "").toLowerCase() === option)?.value || 0;

      voteRows.push({
        id: voteId,
        // Attendance must not depend on the bill being imported. votes.bill_id is nullable
        // (migration 007), so an un-imported bill leaves the roll call standing on its own
        // instead of failing the FK.
        bill_id: storedBillIds.has(bill.id || "") ? bill.id! : null,
        canonical_id: voteId,
        bill_number: bill.identifier || "State Bill",
        title: vote.motion_text || "State vote",
        /*
         * Normalized to the same Senate/House vocabulary as everything else. That is only safe
         * because jurisdiction_type and state_code travel with it -- this line used to produce a
         * bare "Senate" that no read path could tell apart from a US Senate roll call, and the
         * California State Senate alone outnumbered the real one two to one.
         */
        chamber: normalizeChamber(chamber) || "State Legislature",
        jurisdiction_type: "state",
        state_code: state.toUpperCase(),
        date_label: displayDate(vote.start_date),
        result: vote.result || "Unknown",
        yea: count("yes"),
        nay: count("no"),
        present: count("present"),
        not_voting: vote.counts?.find((item) => (item.option || "").toLowerCase().includes("not"))?.value || 0,
        source_system: "openstates",
        source_id: voteId,
        synced_at: now,
        raw_payload: vote,
      });

      positionRows.push(...matched);
    }
  }

  const result: StateVoteSyncResult = {
    state: state.toUpperCase(),
    billsScanned: bills.length,
    votesImported: voteRows.length,
    positionsMatched: positionRows.length,
    positionsUnmatched: [...unmatched.values()].reduce((sum, value) => sum + value, 0),
    politiciansUpdated: 0,
    unmatchedNames: [...unmatched.keys()].slice(0, 25),
  };

  if (options.dryRun || voteRows.length === 0) {
    return result;
  }

  await appendStoredVotes(voteRows, positionRows);

  // Recompute from the member's full stored history rather than the delta, so re-running the sync
  // is idempotent instead of double-counting positions it already imported.
  const affectedIds = new Set(positionRows.map((row) => row.politician_id));
  const affectedRows = politicianRows.filter((row) => affectedIds.has(row.id));

  const storedPositions = await fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `politician_id=in.(${[...affectedIds].map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",")})&order=vote_id.asc`,
    { cache: "no-store", paginateAll: true, pageSize: 1000, select: "vote_id,politician_id,party,vote" },
  );

  const updated = buildUpdatedPoliticianRowsFromVotePositions(affectedRows, storedPositions);
  if (updated.length > 0) {
    await upsertStoredPoliticians(updated);
  }

  result.politiciansUpdated = updated.length;
  return result;
}
