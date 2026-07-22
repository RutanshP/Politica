import type { PoliticianRow, VotePositionRow } from "@/types/supabase";

export interface VoteStatCounters {
  totalVotes: number;
  castVotes: number;
  withPartyCount: number;
  againstPartyCount: number;
}

type VoteStatPositionRow = Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">;

function normalizePartyCode(value?: string | null) {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.startsWith("D")) return "D";
  if (normalized.startsWith("R")) return "R";
  if (normalized.startsWith("I")) return "I";
  return normalized.slice(0, 1);
}

function emptyVoteCounters(): VoteStatCounters {
  return {
    totalVotes: 0,
    castVotes: 0,
    withPartyCount: 0,
    againstPartyCount: 0,
  };
}

export function ensureVoteStatCounters(stats: PoliticianRow["stats"]) {
  return mergeVoteStatCounters(stats, readVoteStatCounters(stats));
}

export function readVoteStatCounters(stats: PoliticianRow["stats"] | undefined): VoteStatCounters {
  const currentStats = (stats || {}) as Partial<VoteStatCounters>;
  return {
    totalVotes: currentStats.totalVotes || 0,
    castVotes: currentStats.castVotes || 0,
    withPartyCount: currentStats.withPartyCount || 0,
    againstPartyCount: currentStats.againstPartyCount || 0,
  };
}

export function hasStoredVoteStatCounters(stats: PoliticianRow["stats"] | undefined) {
  if (!stats) {
    return false;
  }

  return typeof stats.totalVotes === "number"
    && typeof stats.castVotes === "number"
    && typeof stats.withPartyCount === "number"
    && typeof stats.againstPartyCount === "number";
}

function buildVoteStatAccumulator(positionRows: VoteStatPositionRow[]) {
  const byVoteId = new Map<string, VoteStatPositionRow[]>();

  positionRows.forEach((row) => {
    const items = byVoteId.get(row.vote_id) || [];
    items.push(row);
    byVoteId.set(row.vote_id, items);
  });

  const statAccumulator = new Map<string, VoteStatCounters>();

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
      const stats = statAccumulator.get(position.politician_id) || emptyVoteCounters();
      stats.totalVotes += 1;

      if (position.vote !== "Not Voting") {
        stats.castVotes += 1;
      }

      const partyCode = normalizePartyCode(position.party);
      const partyTally = partyTallies.get(partyCode);
      if (partyTally && position.vote !== "Present" && position.vote !== "Not Voting") {
        const partyMajority = partyTally.yea === partyTally.nay
          ? null
          : partyTally.yea > partyTally.nay
            ? "Yea"
            : "Nay";

        if (partyMajority === position.vote) {
          stats.withPartyCount += 1;
        } else if (partyMajority) {
          stats.againstPartyCount += 1;
        }
      }

      statAccumulator.set(position.politician_id, stats);
    });
  });

  return statAccumulator;
}

export function mergeVoteStatCounters(
  currentStats: PoliticianRow["stats"],
  nextCounters: VoteStatCounters,
) {
  const comparableVotes = nextCounters.withPartyCount + nextCounters.againstPartyCount;

  return {
    ...currentStats,
    totalVotes: nextCounters.totalVotes,
    castVotes: nextCounters.castVotes,
    withPartyCount: nextCounters.withPartyCount,
    againstPartyCount: nextCounters.againstPartyCount,
    attendance: nextCounters.totalVotes > 0
      ? Math.round((nextCounters.castVotes / nextCounters.totalVotes) * 100)
      : currentStats.attendance,
    votesWithParty: comparableVotes > 0
      ? Math.round((nextCounters.withPartyCount / comparableVotes) * 100)
      : currentStats.votesWithParty,
    votesAgainstParty: comparableVotes > 0
      ? Math.round((nextCounters.againstPartyCount / comparableVotes) * 100)
      : currentStats.votesAgainstParty,
  };
}

export function buildUpdatedPoliticianRowsFromVotePositions(
  politicianRows: PoliticianRow[],
  positionRows: VoteStatPositionRow[],
) {
  const statAccumulator = buildVoteStatAccumulator(positionRows);

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
      const nextCounters = statAccumulator.get(row.id)!;

      return {
        ...row,
        stats: mergeVoteStatCounters(currentStats, nextCounters),
        last_stats_recomputed_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      };
    });
}

/**
 * Sets vote-stat counters from authoritative per-member totals.
 *
 * This replaces an earlier `applyVotePositionDeltaToPoliticians`, which added each sync's batch
 * to the stored values. Because `vote_positions` upserts idempotently but the counters did not,
 * re-ingesting a roll call counted it twice, and the counters drifted permanently away from the
 * table they were meant to summarize -- only 52 of 550 federal members still agreed with it.
 *
 * Counters are now computed in Postgres (politician_vote_stat_counters) and assigned, never
 * accumulated, so a repeated sync is a no-op instead of a double count.
 */
export function applyVoteStatCountersToPoliticians(
  politicianRows: PoliticianRow[],
  countersByPoliticianId: Map<string, VoteStatCounters>,
) {
  const timestamp = new Date().toISOString();

  return politicianRows.map((row) => {
    const counters = countersByPoliticianId.get(row.id);
    if (!counters) {
      return row;
    }

    const currentStats = row.stats || {
      votesWithParty: 0,
      votesAgainstParty: 0,
      attendance: 0,
      billsIntroduced: 0,
      billsPassed: 0,
      amendmentsOffered: 0,
    };

    return {
      ...row,
      stats: mergeVoteStatCounters(currentStats, counters),
      last_stats_recomputed_at: timestamp,
      synced_at: timestamp,
    };
  });
}

/** Adapts the RPC's snake_case rows into the counter shape used throughout the sync code. */
export function toVoteStatCounterMap(
  rows: Array<{
    politician_id: string;
    total_votes: number;
    cast_votes: number;
    with_party_count: number;
    against_party_count: number;
  }>,
) {
  return new Map<string, VoteStatCounters>(
    rows.map((row) => [
      row.politician_id,
      {
        totalVotes: Number(row.total_votes) || 0,
        castVotes: Number(row.cast_votes) || 0,
        withPartyCount: Number(row.with_party_count) || 0,
        againstPartyCount: Number(row.against_party_count) || 0,
      },
    ]),
  );
}
