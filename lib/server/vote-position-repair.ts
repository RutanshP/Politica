import { normalizeFederalVoteMatchKey } from "@/lib/adapters/federal-votes";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import { upsertStoredPoliticians } from "@/lib/supabase/politicians";
import { buildUpdatedPoliticianRowsFromVotePositions } from "@/lib/server/vote-stats";
import { normalizePersonLookup } from "@/lib/utils";
import type { PoliticianRow, VotePositionRow } from "@/types/supabase";

/**
 * Re-links roll-call positions that were stored against placeholder politicians.
 *
 * When the federal vote sync runs before a member exists in `politicians`, the position falls
 * through to a synthetic `unmatched-<source>-<name>-<state>` id (legislation-sync.ts). Those ids
 * then persist: the real member's stats stay at zero forever, and the placeholder shows up in the
 * directory as a duplicate "Federal Legislator".
 *
 * This repairs the stored rows in place. It needs no external API calls -- the name/state/party on
 * each position row is enough to match against the members already in Supabase.
 */

const POSITION_SELECT = "vote_id,politician_id,name,party,state,vote,source_system,source_id,synced_at";

function normalizePartyCode(value?: string | null) {
  const normalized = (value || "").trim().toUpperCase();
  if (!normalized) return "";
  if (normalized.startsWith("D")) return "D";
  if (normalized.startsWith("R")) return "R";
  if (normalized.startsWith("I")) return "I";
  return normalized.slice(0, 1);
}

function buildNameVariants(name: string) {
  const normalized = normalizePersonLookup(name);
  if (!normalized) return [] as string[];

  const tokens = normalized.split(" ").filter(Boolean);
  const variants = new Set<string>([normalized]);

  // "Adam B. Schiff" in the member table vs "Adam Schiff" on the roll call.
  if (tokens.length >= 3) {
    variants.add(`${tokens[0]} ${tokens[tokens.length - 1]}`);
  }
  if (tokens.length >= 2) {
    variants.add(tokens[tokens.length - 1]);
  }

  return [...variants];
}

/** Real (non-placeholder) federal members, keyed by every name/state/party spelling they have. */
function buildRepairLookup(rows: PoliticianRow[]) {
  const byKey = new Map<string, string>();
  const byLastNameState = new Map<string, string[]>();

  for (const row of rows) {
    if (row.jurisdiction_type !== "federal" || row.id.startsWith("unmatched-")) {
      continue;
    }

    const rawMember = (row.raw_member ?? row.raw_payload ?? {}) as Record<string, unknown>;
    const names = [
      row.name,
      typeof rawMember.directOrderName === "string" ? rawMember.directOrderName : "",
      typeof rawMember.invertedOrderName === "string"
        ? rawMember.invertedOrderName.split(",").reverse().join(" ").trim()
        : "",
      [rawMember.firstName, rawMember.lastName]
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
        .join(" "),
    ].filter(Boolean) as string[];

    const stateCode = (row.state_code || "").trim().toUpperCase();
    const partyCode = normalizePartyCode(row.party);

    for (const name of names) {
      for (const variant of buildNameVariants(name)) {
        const key = normalizeFederalVoteMatchKey({ name: variant, state: stateCode, party: partyCode });
        if (key && !byKey.has(key)) {
          byKey.set(key, row.id);
        }
      }

      // Party is the least reliable field (independents caucusing with a party are recorded
      // inconsistently between the member list and the roll call), so keep a party-free index
      // as a second pass rather than dropping the match entirely.
      const tokens = normalizePersonLookup(name).split(" ").filter(Boolean);
      const lastName = tokens[tokens.length - 1];
      if (lastName && stateCode) {
        const key = `${lastName}|${stateCode}`;
        const existing = byLastNameState.get(key) || [];
        if (!existing.includes(row.id)) {
          byLastNameState.set(key, [...existing, row.id]);
        }
      }
    }
  }

  return { byKey, byLastNameState };
}

function resolvePoliticianId(
  position: VotePositionRow,
  lookup: ReturnType<typeof buildRepairLookup>,
) {
  const state = (position.state || "").trim().toUpperCase();

  const exact = lookup.byKey.get(
    normalizeFederalVoteMatchKey({
      name: position.name,
      state,
      party: normalizePartyCode(position.party),
    }),
  );
  if (exact) return exact;

  const tokens = normalizePersonLookup(position.name).split(" ").filter(Boolean);
  const lastName = tokens[tokens.length - 1];
  if (!lastName || !state) return undefined;

  // Only accept a party-free match when it is unambiguous for that state.
  const candidates = lookup.byLastNameState.get(`${lastName}|${state}`) || [];
  return candidates.length === 1 ? candidates[0] : undefined;
}

export async function repairUnmatchedVotePositions(options?: { dryRun?: boolean }) {
  const [politicianRows, unmatchedPositions] = await Promise.all([
    fetchSupabaseRows<PoliticianRow>("politicians", "order=id.asc", {
      cache: "no-store",
      paginateAll: true,
      select: "id,slug,name,title,party,state,district,biography,born,education,occupation,website,office_phone,office_address,next_election,stats,ideology,source,source_system,source_id,jurisdiction_type,state_code,session_id,synced_at,raw_member",
    }),
    fetchSupabaseRows<VotePositionRow>("vote_positions", "politician_id=like.unmatched-*&order=vote_id.asc", {
      cache: "no-store",
      paginateAll: true,
      pageSize: 1000,
      select: POSITION_SELECT,
    }),
  ]);

  const lookup = buildRepairLookup(politicianRows);

  const repaired: VotePositionRow[] = [];
  const staleKeys: Array<{ voteId: string; politicianId: string }> = [];
  const stillUnmatched = new Map<string, number>();

  for (const position of unmatchedPositions) {
    const resolvedId = resolvePoliticianId(position, lookup);

    if (!resolvedId) {
      stillUnmatched.set(position.politician_id, (stillUnmatched.get(position.politician_id) || 0) + 1);
      continue;
    }

    repaired.push({ ...position, politician_id: resolvedId });
    staleKeys.push({ voteId: position.vote_id, politicianId: position.politician_id });
  }

  const resolvedPlaceholderIds = [
    ...new Set(staleKeys.map((key) => key.politicianId)),
  ];

  if (options?.dryRun) {
    return {
      dryRun: true,
      scanned: unmatchedPositions.length,
      repairable: repaired.length,
      placeholdersResolved: resolvedPlaceholderIds.length,
      stillUnmatched: [...stillUnmatched.entries()].map(([id, count]) => ({ id, count })),
      at: new Date().toISOString(),
    };
  }

  // Insert under the correct politician_id first. The primary key is (vote_id, politician_id),
  // so the corrected row is a new key -- nothing is overwritten and a mid-run failure leaves the
  // original rows intact rather than losing positions.
  await upsertSupabaseRowsInChunks("vote_positions", repaired, "vote_id,politician_id", 500);

  // Then drop the placeholder-keyed duplicates, and the placeholder members themselves.
  for (let index = 0; index < resolvedPlaceholderIds.length; index += 25) {
    const chunk = resolvedPlaceholderIds.slice(index, index + 25);
    const quoted = chunk.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");
    await deleteSupabaseRows("vote_positions", `politician_id=in.(${quoted})`);
    await deleteSupabaseRows("politicians", `id=in.(${quoted})`);
  }

  // Recompute counters for every member that just gained positions. mergeVoteStatCounters derives
  // attendance / votesWithParty / votesAgainstParty from the cumulative counters, so this is a
  // recount of the affected members only -- not of the whole table.
  const affectedIds = [...new Set(repaired.map((row) => row.politician_id))];
  const recomputed: string[] = [];

  for (let index = 0; index < affectedIds.length; index += 40) {
    const chunk = affectedIds.slice(index, index + 40);
    const quoted = chunk.map((value) => `"${value.replace(/"/g, '\\"')}"`).join(",");

    const positions = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `politician_id=in.(${quoted})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, pageSize: 1000, select: "vote_id,politician_id,party,vote" },
    );

    const rows = politicianRows.filter((row) => chunk.includes(row.id));
    const updated = buildUpdatedPoliticianRowsFromVotePositions(rows, positions);

    if (updated.length > 0) {
      await upsertStoredPoliticians(updated);
      recomputed.push(...updated.map((row) => row.id));
    }
  }

  return {
    dryRun: false,
    scanned: unmatchedPositions.length,
    repaired: repaired.length,
    placeholdersRemoved: resolvedPlaceholderIds.length,
    politiciansRecomputed: recomputed.length,
    stillUnmatched: [...stillUnmatched.entries()].map(([id, count]) => ({ id, count })),
    at: new Date().toISOString(),
  };
}
