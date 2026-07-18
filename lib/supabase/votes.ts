import { classifyVote } from "@/lib/vote-classification";
import { deleteSupabaseRows, fetchSupabasePage, fetchSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { VotePosition, Vote } from "@/types/civic";
import type { VotePositionRow, VoteRow } from "@/types/supabase";
import { normalizePartyLabel, normalizeStateLabel } from "@/lib/utils";

const votePositionStatSelect = "vote_id,politician_id,party,vote";

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function mapRowToVotePosition(row: VotePositionRow): VotePosition {
  return {
    politicianId: row.politician_id,
    name: row.name,
    party: normalizePartyLabel(row.party),
    state: normalizeStateLabel(row.state),
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
    billId: row.bill_id || undefined,
    billNumber: row.bill_number,
    title: row.title,
    chamber: row.chamber,
    dateLabel: row.date_label,
    result: row.result,
    yea: row.yea,
    nay: row.nay,
    present: row.present,
    notVoting: row.not_voting,
    category: classifyVote(row.title),
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
  const voteRows = await fetchSupabaseRows<VoteRow>("votes", "order=date_label.desc", { cache: "no-store", paginateAll: true });
  const positionRows = await listStoredVotePositionsByVoteIds(voteRows.map((row) => row.id));

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotesByBillId(billId: string) {
  const voteRows = await fetchSupabaseRows<VoteRow>("votes", `bill_id=eq.${encodeURIComponent(billId)}&order=date_label.desc`, { cache: "no-store", paginateAll: true });
  const wantedVoteIds = new Set(voteRows.map((row) => row.id));
  const positionRows = await listStoredVotePositionsByVoteIds([...wantedVoteIds]);
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
    { cache: "no-store", paginateAll: true },
  );

  const voteIds = [...new Set(positionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  const voteRows = await fetchSupabaseRows<VoteRow>(
    "votes",
    `id=in.(${buildQuotedInFilter(voteIds)})&order=date_label.desc`,
    { cache: "no-store", paginateAll: true },
  );

  const positionsByVoteId = new Map<string, VotePositionRow[]>();
  for (const row of positionRows) {
    const items = positionsByVoteId.get(row.vote_id) || [];
    items.push(row);
    positionsByVoteId.set(row.vote_id, items);
  }

  return voteRows.map((row) => mapRowToVote(row, positionsByVoteId.get(row.id) || []));
}

export async function listStoredVotePositionContextByPoliticianId(politicianId: string) {
  const positionRows = await fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=vote_id.asc`,
    { cache: "no-store", paginateAll: true },
  );

  const voteIds = [...new Set(positionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  return fetchSupabaseRows<VotePositionRow>(
    "vote_positions",
    `vote_id=in.(${buildQuotedInFilter(voteIds)})&order=vote_id.asc,name.asc`,
    { cache: "no-store", paginateAll: true },
  );
}

export async function listStoredVotePositionContextByPoliticianIds(politicianIds: string[]) {
  if (politicianIds.length === 0) {
    return [] as VotePositionRow[];
  }

  const chunkSize = 50;
  const politicianPositionRows: VotePositionRow[] = [];

  for (let index = 0; index < politicianIds.length; index += chunkSize) {
    const chunk = politicianIds.slice(index, index + chunkSize);
    const rows = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `politician_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true },
    );
    politicianPositionRows.push(...rows);
  }

  const voteIds = [...new Set(politicianPositionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  return listStoredVotePositionsByVoteIds(voteIds);
}

export async function listStoredVoteHeaders() {
  return fetchSupabaseRows<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
    "votes",
    "order=id.asc",
    {
      cache: "no-store",
      select: "id,canonical_id,source_system,bill_id",
      paginateAll: true,
    },
  );
}

export async function listStoredVoteHeadersByBillIds(billIds: string[]) {
  if (billIds.length === 0) {
    return [] as Array<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>;
  }

  const chunkSize = 100;
  const rows: Array<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">> = [];

  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
      "votes",
      `bill_id=in.(${buildQuotedInFilter(chunk)})&order=id.asc`,
      {
        cache: "no-store",
        select: "id,canonical_id,source_system,bill_id",
        paginateAll: true,
      },
    );
    rows.push(...result);
  }

  return rows;
}

export async function listStoredFederalVoteHeadersPage(limit: number, offset: number) {
  return fetchSupabasePage<Pick<VoteRow, "id" | "canonical_id" | "source_system" | "bill_id">>(
    "votes",
    "source_system=in.(house_clerk,senate_lis)&order=id.asc",
    {
      cache: "no-store",
      select: "id,canonical_id,source_system,bill_id",
      limit,
      offset,
    },
  );
}

export async function listStoredVotePositionsByVoteIds(voteIds: string[]) {
  if (voteIds.length === 0) {
    return [] as VotePositionRow[];
  }

  const chunkSize = 100;
  const rows: VotePositionRow[] = [];
  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<VotePositionRow>(
      "vote_positions",
      `vote_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc,name.asc`,
      { cache: "no-store", paginateAll: true },
    );
    rows.push(...result);
  }

  return rows;
}

export async function listStoredVoteStatContextByPoliticianIds(politicianIds: string[]) {
  if (politicianIds.length === 0) {
    return [] as Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[];
  }

  const chunkSize = 50;
  const politicianPositionRows: Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[] = [];

  for (let index = 0; index < politicianIds.length; index += chunkSize) {
    const chunk = politicianIds.slice(index, index + chunkSize);
    const rows = await fetchSupabaseRows<Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">>(
      "vote_positions",
      `politician_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, select: votePositionStatSelect },
    );
    politicianPositionRows.push(...rows);
  }

  const voteIds = [...new Set(politicianPositionRows.map((row) => row.vote_id))];
  if (voteIds.length === 0) {
    return [];
  }

  const rows: Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">[] = [];

  for (let index = 0; index < voteIds.length; index += 100) {
    const chunk = voteIds.slice(index, index + 100);
    const result = await fetchSupabaseRows<Pick<VotePositionRow, "vote_id" | "politician_id" | "party" | "vote">>(
      "vote_positions",
      `vote_id=in.(${buildQuotedInFilter(chunk)})&order=vote_id.asc`,
      { cache: "no-store", paginateAll: true, select: votePositionStatSelect },
    );
    rows.push(...result);
  }

  return rows;
}

export async function replaceStoredVotes(voteIds: string[], voteRows: VoteRow[], positionRows: VotePositionRow[]) {
  const chunkSize = 100;

  for (let index = 0; index < voteIds.length; index += chunkSize) {
    const chunk = voteIds.slice(index, index + chunkSize);
    await deleteSupabaseRows("vote_positions", `vote_id=in.(${buildQuotedInFilter(chunk)})`);
    await deleteSupabaseRows("votes", `id=in.(${buildQuotedInFilter(chunk)})`);
  }

  const storedVotes = voteRows.length > 0
    ? await upsertSupabaseRowsInChunks("votes", voteRows, "id", 100)
    : [];
  if (positionRows.length > 0) {
    await upsertSupabaseRowsInChunks("vote_positions", positionRows, "vote_id,politician_id", 250);
  }

  return storedVotes;
}

export async function appendStoredVotes(voteRows: VoteRow[], positionRows: VotePositionRow[]) {
  const storedVotes = voteRows.length > 0
    ? await upsertSupabaseRowsInChunks("votes", voteRows, "id", 100)
    : [];

  if (positionRows.length > 0) {
    await upsertSupabaseRowsInChunks("vote_positions", positionRows, "vote_id,politician_id", 250);
  }

  return storedVotes;
}
