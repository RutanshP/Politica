import type { PoliticianRow, VotePositionRow } from "@/types/supabase";

function normalizePartyCode(value?: string | null) {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.startsWith("D")) return "D";
  if (normalized.startsWith("R")) return "R";
  if (normalized.startsWith("I")) return "I";
  return normalized.slice(0, 1);
}

export function buildUpdatedPoliticianRowsFromVotePositions(
  politicianRows: PoliticianRow[],
  positionRows: VotePositionRow[],
) {
  const byVoteId = new Map<string, VotePositionRow[]>();

  positionRows.forEach((row) => {
    const items = byVoteId.get(row.vote_id) || [];
    items.push(row);
    byVoteId.set(row.vote_id, items);
  });

  const statAccumulator = new Map<string, {
    totalVotes: number;
    castVotes: number;
    withParty: number;
    againstParty: number;
  }>();

  byVoteId.forEach((votePositions) => {
    const partyTallies = new Map<string, { yea: number; nay: number }>();

    votePositions.forEach((position) => {
      const partyCode = normalizePartyCode(position.party);
      if (!partyCode || (position.vote !== "Yea" && position.vote !== "Nay")) {
        return;
      }

      const tally = partyTallies.get(partyCode) || { yea: 0, nay: 0 };
      if (position.vote === "Yea") tally.yea += 1;
      if (position.vote === "Nay") tally.nay += 1;
      partyTallies.set(partyCode, tally);
    });

    votePositions.forEach((position) => {
      const politician = politicianRows.find((candidate) => candidate.id === position.politician_id);
      if (!politician) {
        return;
      }

      const stats = statAccumulator.get(position.politician_id) || {
        totalVotes: 0,
        castVotes: 0,
        withParty: 0,
        againstParty: 0,
      };
      stats.totalVotes += 1;

      if (position.vote !== "Not Voting") {
        stats.castVotes += 1;
      }

      const partyCode = normalizePartyCode(position.party || politician.party);
      const partyTally = partyTallies.get(partyCode);
      if (partyTally && position.vote !== "Present" && position.vote !== "Not Voting") {
        const partyMajority = partyTally.yea === partyTally.nay
          ? null
          : partyTally.yea > partyTally.nay
            ? "Yea"
            : "Nay";

        if (partyMajority === position.vote) {
          stats.withParty += 1;
        } else if (partyMajority) {
          stats.againstParty += 1;
        }
      }

      statAccumulator.set(position.politician_id, stats);
    });
  });

  return politicianRows
    .filter((row) => statAccumulator.has(row.id))
    .map((row) => {
      const currentStats = row.stats || {
        votesWithParty: 0,
        votesAgainstParty: 0,
        attendance: 0,
        billsIntroduced: 0,
        billsPassed: 0,
        amendmentsOffered: 0,
      };
      const nextStats = statAccumulator.get(row.id)!;
      const comparableVotes = nextStats.withParty + nextStats.againstParty;

      return {
        ...row,
        stats: {
          ...currentStats,
          attendance: nextStats.totalVotes > 0 ? Math.round((nextStats.castVotes / nextStats.totalVotes) * 100) : currentStats.attendance,
          votesWithParty: comparableVotes > 0 ? Math.round((nextStats.withParty / comparableVotes) * 100) : currentStats.votesWithParty,
          votesAgainstParty: comparableVotes > 0 ? Math.round((nextStats.againstParty / comparableVotes) * 100) : currentStats.votesAgainstParty,
        },
        synced_at: new Date().toISOString(),
      };
    });
}
