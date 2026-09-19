import { NETWORK_CYCLE, tidyCommitteeName } from "@/lib/data/congress-network";
import { isRealEmployer } from "@/lib/graph/fec-graph-normalizer";
import type { PacCategory } from "@/lib/graph/pac-classification";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { FUNDING_GRAPH_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows, fetchSupabaseRpcRows } from "@/lib/supabase/rest";

/*
 * The /money dashboard, read from the funding graph the FEC and LDA syncs keep current.
 *
 * It used to read finance_entities / finance_edges, which the old finance sync last wrote on
 * 2026-07-11 and which have been empty since -- so every tile showed 0 and "No PACs available yet"
 * while graph_edges held $2B across 8,000+ relationships.
 *
 * What the stored data can and cannot say, which shapes the sections below:
 *   - FEC totals arrive per candidate, with "PACs & party committees" rolled into one figure.
 *     Named PACs come from the separate PAC sync (pac_contributions) -- see getTopPacs.
 *   - Employer figures are itemized individual contributions grouped by the employer each donor
 *     reported -- not money from the company itself.
 *   - Lobbying is LDA-reported spend, and only for clients that also appear as donor employers
 *     (see lobbying_graph_rollup), so it is a subset of all lobbying, not the whole of it.
 */

export interface MoneyRankRow {
  id: string;
  label: string;
  href?: string;
  /** The Congress money network, focused on this row -- members only; the network has no employers. */
  networkHref?: string;
  amount: number;
  count: number;
  detail?: string;
}

export interface MoneyDashboard {
  configured: boolean;
  cycle: number | null;
  totals: {
    raisedByMembers: number;
    membersWithFilings: number;
    outsideSpending: number;
    lobbying: number;
  };
  topFundraisers: MoneyRankRow[];
  topEmployers: MoneyRankRow[];
  outsideSpending: Array<MoneyRankRow & { support: number; oppose: number }>;
  lobbyingClients: MoneyRankRow[];
  lobbyingFirms: MoneyRankRow[];
}

interface EdgeRow {
  source_entity_id: string;
  target_entity_id: string;
  relationship_type: string;
  amount: number | null;
  election_cycle: number | null;
}

interface EntityRow {
  id: string;
  slug: string;
  entity_type: string;
  label: string;
  subtitle: string | null;
}

interface SnapshotRow {
  politician_id: string;
  election_cycle: string;
  receipts: number | null;
}

const TOP_N = 10;
const EDGE_SELECT = "source_entity_id,target_entity_id,relationship_type,amount,election_cycle";
const READ = { tags: [FUNDING_GRAPH_CACHE_TAG], paginateAll: true };

function politicianHref(entity: EntityRow | undefined) {
  return entity?.entity_type === "politician" && entity.slug ? `/politicians/${entity.slug}` : undefined;
}

/** Graph entity ids are "pol-<bioguide>"; the network keys members as "m:<bioguide>". */
function networkHref(entity: EntityRow | undefined) {
  if (entity?.entity_type !== "politician") return undefined;
  return `/money/graph?focus=${encodeURIComponent(`m:${entity.id.replace(/^pol-/, "")}`)}`;
}

/** Sums `amount` per key and counts the distinct counterparties behind each sum. */
function rank(
  edges: EdgeRow[],
  keyOf: (edge: EdgeRow) => string,
  counterpartyOf: (edge: EdgeRow) => string,
) {
  const totals = new Map<string, { amount: number; counterparties: Set<string> }>();
  for (const edge of edges) {
    const key = keyOf(edge);
    const entry = totals.get(key) ?? { amount: 0, counterparties: new Set<string>() };
    entry.amount += Number(edge.amount) || 0;
    entry.counterparties.add(counterpartyOf(edge));
    totals.set(key, entry);
  }
  return [...totals.entries()]
    .map(([id, entry]) => ({ id, amount: entry.amount, count: entry.counterparties.size }))
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount);
}

const EMPTY: MoneyDashboard = {
  configured: false,
  cycle: null,
  totals: { raisedByMembers: 0, membersWithFilings: 0, outsideSpending: 0, lobbying: 0 },
  topFundraisers: [],
  topEmployers: [],
  outsideSpending: [],
  lobbyingClients: [],
  lobbyingFirms: [],
};

export interface TopPacRow {
  committeeId: string;
  name: string;
  category: PacCategory;
  total: number;
  members: number;
  democraticShare: number;
  republicanShare: number;
}

interface TopPacDbRow {
  committee_id: string;
  name: string;
  category: PacCategory;
  total: number | string;
  members: number | string;
  dem_total: number | string;
  rep_total: number | string;
}

/**
 * The committees that gave the most to sitting members this cycle, from the named PAC gifts the
 * PAC sync stores. The dashboard could not show this before: the FEC totals it had rolled every
 * PAC into one "PACs & party committees" figure per member.
 */
export async function getTopPacs(limit = 10): Promise<TopPacRow[]> {
  if (!isSupabaseConfigured()) return [];
  const rows = await fetchSupabaseRpcRows<TopPacDbRow>(
    "top_pac_committees",
    { p_cycle: String(NETWORK_CYCLE), p_limit: String(limit) },
    { tags: [FUNDING_GRAPH_CACHE_TAG] },
  ).catch(() => []);
  return rows.map((row) => {
    const total = Number(row.total) || 0;
    return {
      committeeId: row.committee_id,
      name: tidyCommitteeName(row.name),
      category: row.category,
      total,
      members: Number(row.members) || 0,
      democraticShare: total ? Number(row.dem_total) / total : 0,
      republicanShare: total ? Number(row.rep_total) / total : 0,
    };
  });
}

/** A member's most recent FEC receipts total, or null when no filing is stored for them. */
export async function getMemberReceipts(politicianId: string) {
  if (!isSupabaseConfigured()) return null;
  const rows = await fetchSupabaseRows<SnapshotRow>(
    "candidate_finance_snapshots",
    `politician_id=eq.${encodeURIComponent(politicianId)}&order=election_cycle.desc&limit=1`,
    { tags: [FUNDING_GRAPH_CACHE_TAG], select: "politician_id,election_cycle,receipts" },
  ).catch(() => []);
  const row = rows[0];
  return row ? { cycle: Number(row.election_cycle), receipts: Number(row.receipts) || 0 } : null;
}

export async function getMoneyDashboard(): Promise<MoneyDashboard> {
  if (!isSupabaseConfigured()) return EMPTY;

  const [snapshots, fecEdges, retainedEdges, affiliations] = await Promise.all([
    fetchSupabaseRows<SnapshotRow>("candidate_finance_snapshots", "order=id.asc", {
      ...READ,
      select: "politician_id,election_cycle,receipts",
    }),
    fetchSupabaseRows<EdgeRow>(
      "graph_edges",
      "relationship_type=in.(employee_contributions,independent_spending_support,independent_spending_oppose)&order=id.asc",
      { ...READ, select: EDGE_SELECT },
    ),
    fetchSupabaseRows<EdgeRow>("graph_edges", "relationship_type=eq.retained&order=id.asc", {
      ...READ,
      select: EDGE_SELECT,
    }),
    // Employer money lands on a member's campaign committee; this maps committee -> member.
    fetchSupabaseRows<EdgeRow>("graph_edges", "relationship_type=eq.affiliated_with&order=id.asc", {
      ...READ,
      select: EDGE_SELECT,
    }),
  ]);

  // One cycle only. Members can have both a 2024 and a 2026 snapshot stored, and summing across
  // them would count a member's money twice.
  const cycle = snapshots.reduce((latest, row) => Math.max(latest, Number(row.election_cycle) || 0), 0) || null;
  const cycleSnapshots = snapshots.filter((row) => Number(row.election_cycle) === cycle);
  const cycleEdges = fecEdges.filter((edge) => edge.election_cycle === cycle);

  const memberByCommittee = new Map(affiliations.map((edge) => [edge.source_entity_id, edge.target_entity_id]));
  const employerEdges = cycleEdges.filter((edge) => edge.relationship_type === "employee_contributions");
  const ieEdges = cycleEdges.filter((edge) => edge.relationship_type !== "employee_contributions");

  const fundraisers = cycleSnapshots
    .map((row) => ({ id: `pol-${row.politician_id}`, amount: Number(row.receipts) || 0, count: 0 }))
    .filter((row) => row.amount > 0)
    .sort((left, right) => right.amount - left.amount);
  const employers = rank(
    employerEdges,
    (edge) => edge.source_entity_id,
    (edge) => memberByCommittee.get(edge.target_entity_id) ?? edge.target_entity_id,
  );
  // Over-fetched, then filtered once labels are known: edges stored before isRealEmployer caught
  // "NULL" and "INFORMATION REQUESTED PER BEST EFFORTS" linger until each member re-syncs.
  const employerCandidates = employers.slice(0, TOP_N * 3);
  const ieTargets = rank(ieEdges, (edge) => edge.target_entity_id, (edge) => edge.source_entity_id);
  const clients = rank(retainedEdges, (edge) => edge.source_entity_id, (edge) => edge.target_entity_id);
  const firms = rank(retainedEdges, (edge) => edge.target_entity_id, (edge) => edge.source_entity_id);

  const shown = {
    fundraisers: fundraisers.slice(0, TOP_N),
    employers: employerCandidates,
    ieTargets: ieTargets.slice(0, TOP_N),
    clients: clients.slice(0, TOP_N),
    firms: firms.slice(0, TOP_N),
  };

  // Labels only for the rows actually displayed, not the whole graph.
  const labelIds = [...new Set(Object.values(shown).flat().map((row) => row.id))];
  const entities: EntityRow[] = [];
  for (let index = 0; index < labelIds.length; index += 100) {
    const chunk = labelIds.slice(index, index + 100).map((id) => `"${id}"`).join(",");
    entities.push(...await fetchSupabaseRows<EntityRow>("graph_entities", `id=in.(${chunk})`, {
      tags: [FUNDING_GRAPH_CACHE_TAG],
      select: "id,slug,entity_type,label,subtitle",
    }));
  }
  const entityById = new Map(entities.map((entity) => [entity.id, entity]));
  const labelled = (row: { id: string; amount: number; count: number }): MoneyRankRow => {
    const entity = entityById.get(row.id);
    return {
      ...row,
      label: entity?.label ?? row.id,
      href: politicianHref(entity),
      networkHref: networkHref(entity),
      detail: entity?.subtitle ?? undefined,
    };
  };

  const ieByTarget = (target: string, type: string) =>
    ieEdges
      .filter((edge) => edge.target_entity_id === target && edge.relationship_type === type)
      .reduce((sum, edge) => sum + (Number(edge.amount) || 0), 0);

  return {
    configured: true,
    cycle,
    totals: {
      raisedByMembers: fundraisers.reduce((sum, row) => sum + row.amount, 0),
      membersWithFilings: fundraisers.length,
      outsideSpending: ieTargets.reduce((sum, row) => sum + row.amount, 0),
      lobbying: clients.reduce((sum, row) => sum + row.amount, 0),
    },
    topFundraisers: shown.fundraisers.map(labelled),
    topEmployers: shown.employers.map(labelled).filter((row) => isRealEmployer(row.label)).slice(0, TOP_N),
    outsideSpending: shown.ieTargets.map((row) => ({
      ...labelled(row),
      support: ieByTarget(row.id, "independent_spending_support"),
      oppose: ieByTarget(row.id, "independent_spending_oppose"),
    })),
    lobbyingClients: shown.clients.map(labelled),
    lobbyingFirms: shown.firms.map(labelled),
  };
}
