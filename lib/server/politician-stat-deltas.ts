import type { BillRow, PoliticianRow } from "@/types/supabase";

function isPassedBillStatus(status: BillRow["status"]) {
  return status === "Passed Chamber" || status === "Signed";
}

export interface BillSponsorStatDelta {
  billsIntroduced: number;
  billsPassed: number;
}

function emptyBillSponsorStatDelta(): BillSponsorStatDelta {
  return {
    billsIntroduced: 0,
    billsPassed: 0,
  };
}

function applyBillSponsorDelta(
  deltas: Map<string, BillSponsorStatDelta>,
  politicianId: string | null | undefined,
  delta: Partial<BillSponsorStatDelta>,
) {
  if (!politicianId) {
    return;
  }

  const current = deltas.get(politicianId) || emptyBillSponsorStatDelta();
  deltas.set(politicianId, {
    billsIntroduced: current.billsIntroduced + (delta.billsIntroduced || 0),
    billsPassed: current.billsPassed + (delta.billsPassed || 0),
  });
}

export function buildBillSponsorStatDeltas(
  previousBillRows: BillRow[],
  nextBillRows: BillRow[],
  removedBillRows: BillRow[] = [],
) {
  const previousById = new Map(previousBillRows.map((row) => [row.id, row]));
  const deltas = new Map<string, BillSponsorStatDelta>();

  nextBillRows.forEach((row) => {
    const previous = previousById.get(row.id);
    if (!previous) {
      applyBillSponsorDelta(deltas, row.sponsor_id, {
        billsIntroduced: 1,
        billsPassed: isPassedBillStatus(row.status) ? 1 : 0,
      });
      return;
    }

    if (previous.sponsor_id !== row.sponsor_id) {
      applyBillSponsorDelta(deltas, previous.sponsor_id, {
        billsIntroduced: -1,
        billsPassed: isPassedBillStatus(previous.status) ? -1 : 0,
      });
      applyBillSponsorDelta(deltas, row.sponsor_id, {
        billsIntroduced: 1,
        billsPassed: isPassedBillStatus(row.status) ? 1 : 0,
      });
      return;
    }

    if (isPassedBillStatus(previous.status) !== isPassedBillStatus(row.status)) {
      applyBillSponsorDelta(deltas, row.sponsor_id, {
        billsPassed: isPassedBillStatus(row.status) ? 1 : -1,
      });
    }
  });

  removedBillRows.forEach((row) => {
    applyBillSponsorDelta(deltas, row.sponsor_id, {
      billsIntroduced: -1,
      billsPassed: isPassedBillStatus(row.status) ? -1 : 0,
    });
  });

  return deltas;
}

export function applyBillSponsorStatDeltas(
  politicianRows: PoliticianRow[],
  deltas: Map<string, BillSponsorStatDelta>,
) {
  return politicianRows.map((row) => {
    const delta = deltas.get(row.id);
    if (!delta) {
      return row;
    }

    return {
      ...row,
      stats: {
        ...row.stats,
        billsIntroduced: Math.max(0, (row.stats.billsIntroduced || 0) + delta.billsIntroduced),
        billsPassed: Math.max(0, (row.stats.billsPassed || 0) + delta.billsPassed),
      },
      last_stats_recomputed_at: new Date().toISOString(),
      synced_at: new Date().toISOString(),
    };
  });
}

export function mergeStoredPoliticianStats(
  nextStats: PoliticianRow["stats"],
  storedStats?: PoliticianRow["stats"],
) {
  if (!storedStats) {
    return nextStats;
  }

  return {
    ...nextStats,
    votesWithParty: storedStats.votesWithParty ?? nextStats.votesWithParty,
    votesAgainstParty: storedStats.votesAgainstParty ?? nextStats.votesAgainstParty,
    attendance: storedStats.attendance ?? nextStats.attendance,
    billsIntroduced: Math.max(storedStats.billsIntroduced || 0, nextStats.billsIntroduced || 0),
    billsPassed: Math.max(storedStats.billsPassed || 0, nextStats.billsPassed || 0),
    amendmentsOffered: storedStats.amendmentsOffered ?? nextStats.amendmentsOffered,
    totalVotes: storedStats.totalVotes ?? nextStats.totalVotes,
    castVotes: storedStats.castVotes ?? nextStats.castVotes,
    withPartyCount: storedStats.withPartyCount ?? nextStats.withPartyCount,
    againstPartyCount: storedStats.againstPartyCount ?? nextStats.againstPartyCount,
  };
}
