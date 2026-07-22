import "server-only";

import { fetchOpenStatesChamberOrgIds, isOpenStatesConfigured } from "@/lib/adapters/openstates";
import { fetchSupabaseRows, updateSupabaseRows } from "@/lib/supabase/rest";
import { normalizeChamber } from "@/lib/utils";
import type { CommitteeRow } from "@/types/supabase";

export interface CommitteeChamberRepairResult {
  states: string[];
  examined: number;
  resolved: number;
  unresolved: number;
  byChamber: Record<string, number>;
  at: string;
}

/**
 * Assigns a chamber to state committees that arrived without one.
 *
 * OpenStates gives a committee `classification: "committee"` and a `parent_id` pointing at the
 * chamber organization it belongs to, but never the chamber itself -- and the parent is an
 * Organization, which the v3 API does not serve (`/committees/{parent_id}` 404s). So 369 of 389
 * stored state committees had no chamber, and the directory's chamber filter did nothing outside
 * federal.
 *
 * The list endpoint does accept a `chamber` filter, and the committees it returns carry their
 * parent id -- which identifies each chamber organization by elimination. This resolves that map
 * per state and writes the real chamber onto the stored rows. Nothing is guessed: a committee
 * whose parent is not in the map is left alone.
 */
export async function repairStateCommitteeChambers(options?: {
  states?: string[];
}): Promise<CommitteeChamberRepairResult> {
  if (!isOpenStatesConfigured()) {
    throw new Error("OpenStates is not configured");
  }

  const rows = await fetchSupabaseRows<CommitteeRow>(
    "committees",
    "jurisdiction_type=eq.state&order=state_code.asc",
    {
      cache: "no-store",
      paginateAll: true,
      select: "id,slug,name,chamber,jurisdiction,state_code,raw_committee",
    },
  );

  const requested = options?.states?.map((state) => state.toUpperCase());
  const candidates = rows.filter((row) => {
    const stateCode = row.state_code?.toUpperCase();
    if (!stateCode) return false;
    if (requested && !requested.includes(stateCode)) return false;
    // Only rows whose chamber carries no information; never overwrite a known one.
    return normalizeChamber(row.chamber) === null;
  });

  const states = [...new Set(candidates.map((row) => row.state_code!.toUpperCase()))];
  const chamberByParentId = new Map<string, "upper" | "lower">();

  for (const state of states) {
    const map = await fetchOpenStatesChamberOrgIds(state.toLowerCase()).catch(() => new Map());
    map.forEach((chamber, parentId) => chamberByParentId.set(parentId, chamber));
  }

  /*
   * Grouped by chamber and applied with PATCH, not upsert. An upsert of {id, chamber} is a row
   * insert as far as PostgREST is concerned: any id that does not already match writes a new row
   * with every other column null, which fails on `slug NOT NULL` and would otherwise have created
   * junk committees.
   */
  const idsByChamber = new Map<string, string[]>();

  for (const row of candidates) {
    const parentId = (row.raw_committee as { parent_id?: string } | null)?.parent_id;
    const resolved = parentId ? chamberByParentId.get(parentId) : undefined;
    if (!resolved) continue;

    const chamber = normalizeChamber(resolved);
    if (!chamber) continue;

    idsByChamber.set(chamber, [...(idsByChamber.get(chamber) || []), row.id]);
  }

  const byChamber: Record<string, number> = {};
  let updated = 0;

  for (const [chamber, ids] of idsByChamber) {
    byChamber[chamber] = ids.length;
    updated += ids.length;

    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      const filter = chunk.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(",");
      await updateSupabaseRows("committees", `id=in.(${filter})`, { chamber });
    }
  }

  return {
    states,
    examined: candidates.length,
    resolved: updated,
    unresolved: candidates.length - updated,
    byChamber,
    at: new Date().toISOString(),
  };
}
