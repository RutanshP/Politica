import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { VotePosition, Vote } from "@/types/civic";
import type { VotePositionRow, VoteRow } from "@/types/supabase";

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function mapRowToVotePosition(row: VotePositionRow): VotePosition {
  return {
    politicianId: row.politician_id,
    name: row.name,
    party: row.party,
    state: row.state,
    vote: row.vote,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

function mapRowToVote(row: VoteRow, positions: VotePositionRow[]): Vote {
  return {
    id: row.id,
    canonicalId: row.canonical_id || undefined,
    billId: row.bill_id,
    billNumber: row.bill_number,
    title: row.title,
    chamber: row.chamber,
    dateLabel: row.date_label,
    result: row.result,
    yea: row.yea,
    nay: row.nay,
    present: row.present,
    notVoting: row.not_voting,
    positions: positions.map(mapRowToVotePosition),
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

export async function listStoredVotes() {
  const [voteRows, positionRows] = await Promise.all([
    fetchSupabaseRows<VoteRow>("votes", "order=date_label.desc"),
    fetchSupabaseRows<VotePositionRow>("vote_positions", "order=vote_id.asc,name.asc"),
  ]);

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotesByBillId(billId: string) {
  const [voteRows, positionRows] = await Promise.all([
    fetchSupabaseRows<VoteRow>("votes", `bill_id=eq.${encodeURIComponent(billId)}&order=date_label.desc`),
    fetchSupabaseRows<VotePositionRow>("vote_positions", "order=vote_id.asc,name.asc"),
  ]);

  const wantedVoteIds = new Set(voteRows.map((row) => row.id));
  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    if (!wantedVoteIds.has(row.vote_id)) continue;
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotesByPoliticianId(politicianId: string) {
  const positionRows = await fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=vote_id.asc`,
  );

  const voteIds = [...new Set(positionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  const voteRows = await fetchSupabaseRows<VoteRow>(
    "votes",
    `id=in.(${buildQuotedInFilter(voteIds)})&order=date_label.desc`,
  );

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function replaceStoredVotes(voteIds: string[], voteRows: VoteRow[], positionRows: VotePositionRow[]) {
  if (voteIds.length > 0) {
    await deleteSupabaseRows("vote_positions", `vote_id=in.(${buildQuotedInFilter(voteIds)})`);
    await deleteSupabaseRows("votes", `id=in.(${buildQuotedInFilter(voteIds)})`);
  }

  const storedVotes = voteRows.length > 0 ? await upsertSupabaseRows("votes", voteRows, "id") : [];
  if (positionRows.length > 0) {
    await upsertSupabaseRows("vote_positions", positionRows, "vote_id,politician_id");
  }

  return storedVotes;
}
