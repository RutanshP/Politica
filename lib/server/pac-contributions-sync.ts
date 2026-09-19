import "server-only";

import {
  fetchFecCandidateCommittees,
  fetchFecCommitteeGiftsToRecipient,
  fetchFecCommitteesByIds,
  FecQuotaExhaustedError,
  isFecConfigured,
  type FecCommitteeDetailRow,
} from "@/lib/adapters/fec";
import { fetchCongressLegislatorsFecIds } from "@/lib/adapters/congress-legislators";
import { pickFecCandidateId } from "@/lib/graph/fec-graph-normalizer";
import { classifyCommittee, committeeOwner } from "@/lib/graph/pac-classification";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";

/*
 * Named PAC money for every sitting member: which committee gave, to whom, and how much.
 *
 * The funding graph only ever had one "PACs & party committees" figure per member -- FEC's
 * candidate totals -- so no two members could be connected through a PAC they share. This reads
 * FEC's Schedule B aggregates by recipient: every committee that reported paying a member's
 * principal campaign committee in the cycle, totalled per payer. Stored in pac_committees /
 * pac_contributions rather than graph_edges, whose wide rows would cost several times the space
 * for ~80k pairs against a 500MB database.
 *
 * Runs in staleness order, like the FEC funding sync: members never synced first, then oldest.
 */

const DEFAULT_CYCLE = 2026;
const DEFAULT_LIMIT = 20;
const COMMITTEE_BATCH = 100;

export interface PacContributionsSyncOptions {
  limit?: number;
  cycle?: number;
  politicianIds?: string[];
}

interface SyncStateRow {
  politician_id: string;
  principal_committee_id: string | null;
  cycle: number | null;
  committees_found: number;
  synced_at: string;
}

interface CommitteeRow {
  committee_id: string;
  name: string;
  category: string;
  committee_type: string | null;
  designation: string | null;
  organization_type: string | null;
  party: string | null;
  connected_org: string | null;
  sponsor_politician_id: string | null;
  synced_at: string;
}

interface ContributionRow {
  politician_id: string;
  cycle: number;
  committee_id: string;
  total: number;
  contribution_count: number;
  synced_at: string;
}

/**
 * The member's principal campaign committee, trying the likeliest FEC candidate id first.
 *
 * Members often hold more than one candidate id -- a House member now running for the Senate or
 * a governorship files under a new one -- and the id for the seat they hold can have no committee
 * this cycle. Trying only one left those members with "No principal campaign committee on file".
 */
async function findPrincipalCommittee(fecIds: string[], title: string, cycle: number) {
  const preferred = pickFecCandidateId(fecIds, title);
  const candidates = [preferred, ...fecIds.filter((id) => id !== preferred)];
  for (const candidateCycle of [cycle, cycle - 2]) {
    for (const candidateId of candidates) {
      const committees = await fetchFecCandidateCommittees(candidateId, candidateCycle);
      const principal = committees.find((row) => row.designation === "P") || committees.find((row) => row.designation === "A");
      if (principal?.committee_id) return principal.committee_id;
    }
  }
  return null;
}

export async function syncPacContributions(options?: PacContributionsSyncOptions) {
  if (!isFecConfigured()) {
    throw new Error("FEC API is not configured");
  }

  const cycle = options?.cycle ?? DEFAULT_CYCLE;
  const limit = Math.max(1, options?.limit ?? DEFAULT_LIMIT);
  const runStartedAt = new Date().toISOString();

  const [politicians, fecIdsByBioguide, syncState, affiliations, knownCommittees] = await Promise.all([
    listStoredPoliticians({ fresh: true, jurisdictionType: "federal" }),
    fetchCongressLegislatorsFecIds(),
    fetchSupabaseRows<SyncStateRow>("pac_sync_state", "order=politician_id.asc", {
      cache: "no-store",
      paginateAll: true,
      paginateTiebreaker: null,
    }).catch(() => []),
    // The principal committee for each member, as the FEC funding sync already recorded it.
    fetchSupabaseRows<{ source_entity_id: string; target_entity_id: string }>(
      "graph_edges",
      "relationship_type=eq.affiliated_with&order=id.asc",
      { cache: "no-store", paginateAll: true, select: "source_entity_id,target_entity_id" },
    ).catch(() => []),
    fetchSupabaseRows<{ committee_id: string }>("pac_committees", "order=committee_id.asc", {
      cache: "no-store",
      paginateAll: true,
      paginateTiebreaker: null,
      select: "committee_id",
    }).catch(() => []),
  ]);

  const memberIds = new Set(politicians.map((politician) => politician.id));
  const bioguideByFecId = new Map<string, string>();
  for (const [bioguide, fecIds] of fecIdsByBioguide) {
    for (const fecId of fecIds) bioguideByFecId.set(fecId, bioguide);
  }
  const principalByMember = new Map(
    affiliations.map((edge) => [edge.target_entity_id.replace(/^pol-/, ""), edge.source_entity_id.replace(/^fec-cmte-/, "")]),
  );
  const stateByMember = new Map(syncState.map((row) => [row.politician_id, row]));
  const knownCommitteeIds = new Set(knownCommittees.map((row) => row.committee_id));

  let queue = politicians.filter((politician) => fecIdsByBioguide.has(politician.id));
  if (options?.politicianIds?.length) {
    const wanted = new Set(options.politicianIds);
    queue = queue.filter((politician) => wanted.has(politician.id));
  } else {
    queue = [...queue].sort((left, right) => {
      const leftSynced = stateByMember.get(left.id)?.synced_at;
      const rightSynced = stateByMember.get(right.id)?.synced_at;
      if (!leftSynced && !rightSynced) return left.name.localeCompare(right.name);
      if (!leftSynced) return -1;
      if (!rightSynced) return 1;
      return Date.parse(leftSynced) - Date.parse(rightSynced);
    });
  }
  queue = queue.slice(0, limit);

  const failures: Array<{ politicianId: string; error: string }> = [];
  let membersSynced = 0;
  let contributionsWritten = 0;
  let committeesWritten = 0;
  let quotaExhausted = false;
  // Joint fundraisers are not stored, so without this every later member in the run would fetch
  // their committee records again.
  const excludedCommitteeIds = new Set<string>();

  for (const politician of queue) {
    try {
      const ownFecIds = new Set(fecIdsByBioguide.get(politician.id) ?? []);
      let principal = principalByMember.get(politician.id) ?? stateByMember.get(politician.id)?.principal_committee_id ?? null;
      if (!principal) {
        principal = await findPrincipalCommittee(fecIdsByBioguide.get(politician.id)!, politician.title, cycle);
      }
      if (!principal) {
        throw new Error("No principal campaign committee on file");
      }

      const gifts = (await fetchFecCommitteeGiftsToRecipient(principal, cycle))
        .filter((gift) => gift.committee_id && gift.committee_id !== principal && (gift.total ?? 0) > 0);

      // Committee records only for payers not seen before -- most PACs give to many members.
      const unknownIds = [...new Set(gifts.map((gift) => gift.committee_id!))].filter((id) => !knownCommitteeIds.has(id) && !excludedCommitteeIds.has(id));
      const details: FecCommitteeDetailRow[] = [];
      for (let index = 0; index < unknownIds.length; index += COMMITTEE_BATCH) {
        details.push(...await fetchFecCommitteesByIds(unknownIds.slice(index, index + COMMITTEE_BATCH)));
      }

      const committeeRows: CommitteeRow[] = [];
      for (const detail of details) {
        const category = classifyCommittee(detail);
        if (!category) {
          excludedCommitteeIds.add(detail.committee_id);
          continue;
        }
        const owner = committeeOwner(detail, category, bioguideByFecId);
        committeeRows.push({
          committee_id: detail.committee_id,
          name: detail.name || detail.committee_id,
          category,
          committee_type: detail.committee_type ?? null,
          designation: detail.designation ?? null,
          organization_type: detail.organization_type ?? null,
          party: detail.party ?? null,
          connected_org: detail.affiliated_committee_name ?? null,
          sponsor_politician_id: owner && memberIds.has(owner) ? owner : null,
          synced_at: runStartedAt,
        });
      }
      if (committeeRows.length > 0) {
        await upsertSupabaseRowsInChunks("pac_committees", committeeRows, "committee_id", 250);
        committeesWritten += committeeRows.length;
        for (const row of committeeRows) knownCommitteeIds.add(row.committee_id);
      }

      // A member's own committees paying their campaign (their leadership PAC, a second
      // authorized committee) is a transfer, not a connection. Those are dropped here, and
      // joint fundraisers never made it into pac_committees at all.
      const selfCommitteeIds = new Set(
        details
          .filter((detail) =>
            [...(detail.sponsor_candidate_ids ?? []), ...(detail.candidate_ids ?? [])].some((id) => ownFecIds.has(id)))
          .map((detail) => detail.committee_id),
      );

      const contributions: ContributionRow[] = gifts
        .filter((gift) =>
          knownCommitteeIds.has(gift.committee_id!)
          && !excludedCommitteeIds.has(gift.committee_id!)
          && !selfCommitteeIds.has(gift.committee_id!))
        .map((gift) => ({
          politician_id: politician.id,
          cycle,
          committee_id: gift.committee_id!,
          total: Math.round((gift.total ?? 0) * 100) / 100,
          contribution_count: gift.count ?? 0,
          synced_at: runStartedAt,
        }));

      if (contributions.length > 0) {
        await upsertSupabaseRowsInChunks("pac_contributions", contributions, "politician_id,cycle,committee_id", 500);
      }
      await deleteSupabaseRows(
        "pac_contributions",
        `politician_id=eq.${encodeURIComponent(politician.id)}&cycle=eq.${cycle}&synced_at=lt.${runStartedAt}`,
      );
      await upsertSupabaseRowsInChunks("pac_sync_state", [{
        politician_id: politician.id,
        principal_committee_id: principal,
        cycle,
        committees_found: contributions.length,
        synced_at: new Date().toISOString(),
      }], "politician_id", 1);

      contributionsWritten += contributions.length;
      membersSynced += 1;
    } catch (error) {
      // Out of hourly quota: stop here. Everyone finished so far is saved, and the staleness
      // order means the next run starts with whoever this one did not reach.
      if (error instanceof FecQuotaExhaustedError) {
        quotaExhausted = true;
        break;
      }
      failures.push({
        politicianId: politician.id,
        error: error instanceof Error ? error.message : "PAC sync failed",
      });
    }
  }

  if (membersSynced === 0 && failures.length > 0) {
    throw new Error(failures[0].error);
  }

  return {
    cycle,
    membersSynced,
    contributionsWritten,
    committeesWritten,
    quotaExhausted,
    failures,
    at: new Date().toISOString(),
  };
}
