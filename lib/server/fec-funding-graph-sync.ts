import {
  fetchFecCandidateCommittees,
  fetchFecCandidateTotalsDetailed,
  fetchFecScheduleAByEmployer,
  fetchFecScheduleABySize,
  fetchFecScheduleEByCandidate,
  isFecConfigured,
} from "@/lib/adapters/fec";
import { fetchCongressLegislatorsFecIds } from "@/lib/adapters/congress-legislators";
import {
  buildFecGraphRows,
  pickFecCandidateId,
  type FecPoliticianPayloads,
} from "@/lib/graph/fec-graph-normalizer";
import {
  listFecSyncedPoliticianEntities,
  purgeDemoFixture,
  upsertCandidateFinanceSnapshots,
  upsertGraphEdges,
  upsertGraphEntities,
} from "@/lib/supabase/funding-graph";
import { listStoredPoliticians } from "@/lib/supabase/politicians";
import type { GraphEdgeRow, GraphEntityRow } from "@/types/funding-graph";
import type { CandidateFinanceSnapshotRow } from "@/types/supabase";

const DEFAULT_CHUNK_LIMIT = 60;
const DEFAULT_CYCLE = 2026;
const PER_POLITICIAN_DELAY_MS = 200;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FecFundingGraphSyncOptions {
  /** Politicians per run; ~5 FEC calls each against a 1,000 req/hour key. */
  limit?: number;
  cycle?: number;
  /** Explicit politician slugs to sync, bypassing staleness ordering. */
  politicianSlugs?: string[];
}

/**
 * Populates the funding graph from the FEC API, a staleness-ordered chunk of
 * federal members at a time: members never synced first, then oldest. FEC
 * candidate ids come from the unitedstates/congress-legislators crosswalk
 * (bioguide -> fec ids), not name search. Once real data lands for a
 * politician that previously carried the illustrative demo fixture, the
 * fixture is purged.
 */
export async function syncFundingGraphFromFec(options?: FecFundingGraphSyncOptions) {
  if (!isFecConfigured()) {
    throw new Error("FEC API is not configured");
  }

  const limit = Math.max(1, options?.limit ?? DEFAULT_CHUNK_LIMIT);
  const requestedCycle = options?.cycle ?? DEFAULT_CYCLE;

  const [politicians, fecIdsByBioguide, existingEntities] = await Promise.all([
    listStoredPoliticians({ fresh: true, jurisdictionType: "federal" }),
    fetchCongressLegislatorsFecIds(),
    listFecSyncedPoliticianEntities().catch(() => []),
  ]);

  const fecSyncedAtByEntityId = new Map(
    existingEntities
      .filter((entity) => entity.source_system === "fec_sync")
      .map((entity) => [entity.id, entity.synced_at]),
  );
  const demoPoliticianEntityIds = new Set(
    existingEntities
      .filter((entity) => entity.source_system === "demo_fixture")
      .map((entity) => entity.id),
  );

  let queue = politicians.filter((politician) => fecIdsByBioguide.has(politician.id));
  const skippedNoFecId = politicians.length - queue.length;

  if (options?.politicianSlugs?.length) {
    const wanted = new Set(options.politicianSlugs);
    queue = queue.filter((politician) => wanted.has(politician.slug));
  } else {
    queue = [...queue].sort((left, right) => {
      const leftSynced = fecSyncedAtByEntityId.get(`pol-${left.id}`);
      const rightSynced = fecSyncedAtByEntityId.get(`pol-${right.id}`);
      if (!leftSynced && !rightSynced) return left.name.localeCompare(right.name);
      if (!leftSynced) return -1;
      if (!rightSynced) return 1;
      return Date.parse(leftSynced) - Date.parse(rightSynced);
    });
  }
  queue = queue.slice(0, limit);

  const entityRowsById = new Map<string, GraphEntityRow>();
  const edgeRows: GraphEdgeRow[] = [];
  const snapshotRows: CandidateFinanceSnapshotRow[] = [];
  const failures: Array<{ slug: string; error: string }> = [];
  const syncedPoliticianEntityIds: string[] = [];

  for (const politician of queue) {
    try {
      const candidateId = pickFecCandidateId(fecIdsByBioguide.get(politician.id)!, politician.title);

      let cycle = requestedCycle;
      let totals = await fetchFecCandidateTotalsDetailed(candidateId, cycle);
      if (totals.length === 0 && cycle !== requestedCycle - 2) {
        cycle = requestedCycle - 2;
        totals = await fetchFecCandidateTotalsDetailed(candidateId, cycle);
      }

      const committees = await fetchFecCandidateCommittees(candidateId, cycle);
      const principal = committees.find((row) => row.designation === "P")
        || committees.find((row) => row.designation === "A")
        || committees[0];

      const [byEmployer, bySize, scheduleE] = await Promise.all([
        principal?.committee_id
          ? fetchFecScheduleAByEmployer(principal.committee_id, cycle).catch(() => [])
          : Promise.resolve([]),
        principal?.committee_id
          ? fetchFecScheduleABySize(principal.committee_id, cycle).catch(() => [])
          : Promise.resolve([]),
        fetchFecScheduleEByCandidate(candidateId, cycle).catch(() => []),
      ]);

      const payloads: FecPoliticianPayloads = { cycle, totals, committees, byEmployer, bySize, scheduleE };
      const rows = buildFecGraphRows(
        {
          id: politician.id,
          slug: politician.slug,
          name: politician.name,
          title: politician.title,
          party: politician.party,
          state: politician.state,
          district: politician.district,
        },
        candidateId,
        payloads,
      );

      for (const entity of rows.entities) {
        entityRowsById.set(entity.id, entity);
      }
      edgeRows.push(...rows.edges);
      snapshotRows.push(rows.snapshot);
      syncedPoliticianEntityIds.push(`pol-${politician.id}`);
    } catch (error) {
      failures.push({
        slug: politician.slug,
        error: error instanceof Error ? error.message : "FEC sync failed",
      });
    }

    await delay(PER_POLITICIAN_DELAY_MS);
  }

  const entityRows = [...entityRowsById.values()];
  await upsertGraphEntities(entityRows);
  await upsertGraphEdges(edgeRows);
  await upsertCandidateFinanceSnapshots(snapshotRows);

  // Real data has replaced the demo politician: retire the whole fixture.
  const demoPurged = syncedPoliticianEntityIds.some((entityId) => demoPoliticianEntityIds.has(entityId));
  if (demoPurged) {
    await purgeDemoFixture();
  }

  if (syncedPoliticianEntityIds.length === 0 && failures.length > 0) {
    throw new Error(failures[0]?.error || "FEC funding-graph sync produced no records");
  }

  return {
    politiciansSynced: syncedPoliticianEntityIds.length,
    entitiesWritten: entityRows.length,
    edgesWritten: edgeRows.length,
    snapshotsWritten: snapshotRows.length,
    skippedNoFecId,
    failures,
    demoPurged,
    requestedCycle,
    at: new Date().toISOString(),
  };
}
