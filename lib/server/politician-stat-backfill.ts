import { listStoredVoteStatContextByPoliticianIds } from "@/lib/supabase/votes";
import { fetchSupabaseRows, invokeSupabaseRpc } from "@/lib/supabase/rest";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";
import {
  buildUpdatedPoliticianRowsFromVotePositions,
  ensureVoteStatCounters,
  hasStoredVoteStatCounters,
} from "@/lib/server/vote-stats";
import type { PoliticianRow } from "@/types/supabase";

const POLITICIAN_BACKFILL_CHUNK_SIZE = 50;

function getPoliticianBackfillSelect() {
  return [
    "id",
    "slug",
    "name",
    "title",
    "party",
    "state",
    "district",
    "biography",
    "born",
    "education",
    "occupation",
    "website",
    "office_phone",
    "office_address",
    "next_election",
    "stats",
    "ideology",
    "source",
    "source_system",
    "source_id",
    "jurisdiction_type",
    "state_code",
    "session_id",
    "source_updated_at",
    "source_fingerprint",
    "last_profile_synced_at",
    "last_stats_recomputed_at",
    "synced_at",
  ].join(",");
}

export async function listPoliticiansMissingVoteStatCounters() {
  const rows = await fetchSupabaseRows<PoliticianRow>(
    "politicians",
    "order=jurisdiction_type.asc,name.asc",
    { cache: "no-store", paginateAll: true, select: getPoliticianBackfillSelect() },
  );

  return rows.filter((row) => !hasStoredVoteStatCounters(row.stats));
}

export async function backfillMissingPoliticianVoteStatCounters(options?: {
  offset?: number;
  limit?: number;
}) {
  const requestedOffset = Number.isFinite(options?.offset) && (options?.offset ?? 0) > 0
    ? options?.offset as number
    : 0;
  const requestedLimit = Number.isFinite(options?.limit) && (options?.limit ?? 0) > 0
    ? options?.limit as number
    : undefined;

  if (requestedLimit) {
    try {
      const rpcResult = await invokeSupabaseRpc<Array<{
        total_missing: number;
        scanned_missing: number;
        updated: number;
        updated_ids: string[] | null;
      }>>(
        "backfill_politician_vote_stat_counters",
        {
          p_offset: requestedOffset,
          p_limit: requestedLimit,
        },
        { cache: "no-store" },
      );

      const first = rpcResult[0];
      if (first) {
        return {
          totalMissing: first.total_missing || 0,
          scannedMissing: first.scanned_missing || 0,
          updated: first.updated || 0,
          updatedIds: first.updated_ids || [],
          missing: [] as Array<{ id: string; name: string; jurisdictionType: string | null }>,
          requestedOffset,
          requestedLimit,
          at: new Date().toISOString(),
        };
      }
    } catch (error) {
      console.warn("Falling back to JS politician stat backfill", error);
    }
  }

  const allMissingRows = await listPoliticiansMissingVoteStatCounters();
  const missingRows = requestedLimit
    ? allMissingRows.slice(requestedOffset, requestedOffset + requestedLimit)
    : allMissingRows.slice(requestedOffset);

  if (missingRows.length === 0) {
    return {
      totalMissing: allMissingRows.length,
      scannedMissing: 0,
      updated: 0,
      updatedIds: [] as string[],
      missing: [] as Array<{ id: string; name: string; jurisdictionType: string | null }>,
      requestedOffset,
      requestedLimit: requestedLimit ?? null,
      at: new Date().toISOString(),
    };
  }

  const updatedRows: PoliticianRow[] = [];

  for (let index = 0; index < missingRows.length; index += POLITICIAN_BACKFILL_CHUNK_SIZE) {
    const chunk = missingRows.slice(index, index + POLITICIAN_BACKFILL_CHUNK_SIZE);
    const contextRows = await listStoredVoteStatContextByPoliticianIds(chunk.map((row) => row.id)).catch(() => []);
    const recomputedRows = buildUpdatedPoliticianRowsFromVotePositions(chunk, contextRows);
    const recomputedById = new Map(recomputedRows.map((row) => [row.id, row]));
    const chunkRows: PoliticianRow[] = [];

    chunk.forEach((row) => {
      const recomputed = recomputedById.get(row.id);
      if (recomputed) {
        chunkRows.push(recomputed);
        return;
      }

      chunkRows.push({
        ...row,
        stats: ensureVoteStatCounters(row.stats),
        last_stats_recomputed_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      });
    });

    if (chunkRows.length > 0) {
      await upsertStoredPoliticians(chunkRows);
      updatedRows.push(...chunkRows);
    }
  }

  return {
    totalMissing: allMissingRows.length,
    scannedMissing: missingRows.length,
    updated: updatedRows.length,
    updatedIds: updatedRows.map((row) => row.id),
    missing: missingRows.map((row) => ({
      id: row.id,
      name: row.name,
      jurisdictionType: row.jurisdiction_type || null,
    })),
    requestedOffset,
    requestedLimit: requestedLimit ?? null,
    at: new Date().toISOString(),
  };
}

export interface VoteStatReconcileResult {
  examined: number;
  corrected: number;
  at: string;
}

/**
 * Recomputes every stored vote-stat counter from `vote_positions` and rewrites the ones that
 * disagree.
 *
 * Distinct from backfillMissingPoliticianVoteStatCounters, which only ever looked at members with
 * *no* counters. Counters that existed but had drifted were invisible to it -- which is how 498
 * of 550 federal members ended up with a wrong attendance denominator and stayed that way.
 *
 * Runs entirely in Postgres and is idempotent, so it is safe on a schedule.
 */
export async function reconcilePoliticianVoteStats(): Promise<VoteStatReconcileResult> {
  const rows = await invokeSupabaseRpc<Array<{ examined: number; corrected: number }>>(
    "reconcile_politician_vote_stats",
    {},
    { cache: "no-store" },
  );

  const first = rows?.[0];
  return {
    examined: Number(first?.examined) || 0,
    corrected: Number(first?.corrected) || 0,
    at: new Date().toISOString(),
  };
}
