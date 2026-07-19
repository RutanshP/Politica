import { getDefaultCongress } from "@/lib/adapters/congress";
import { mapRowToBill, sortBillsByActivity } from "@/lib/normalizers/legislation";
import { BILLS_CACHE_TAG, COMMITTEES_CACHE_TAG } from "@/lib/supabase/cache-tags";
import {
  deleteSupabaseRows,
  fetchSupabasePage,
  fetchSupabaseRows,
  fetchSupabaseRpcRows,
  upsertSupabaseRows,
  upsertSupabaseRowsInChunks,
} from "@/lib/supabase/rest";
import type { Bill } from "@/types/civic";
import type { BillActionRow, BillRow, BillVersionRow } from "@/types/supabase";

const BILL_LIST_SELECT = [
  "id",
  "slug",
  "number",
  "title",
  "summary",
  "jurisdiction",
  "country",
  "state",
  "chamber",
  "status",
  "topic",
  "sponsor_id",
  "sponsor_name",
  "committee_id",
  "committee_name",
  "latest_action",
  "last_action_at",
  "introduced_at",
  "session",
  "chance_of_passing",
  "stats",
  "related_bill_ids",
  "source",
  "source_system",
  "source_id",
  "jurisdiction_type",
  "state_code",
  "session_id",
  "synced_at",
].join(",");

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

function escapeIlikeValue(value: string) {
  return value.replace(/[%*,()]/g, " ").trim();
}

export interface StoredBillsPageQuery {
  page: number;
  pageSize: number;
  query?: string;
  chamber?: string;
  status?: string;
  session?: string;
  topic?: string;
  sponsor?: string;
  committee?: string;
  sortBy?: string;
}

// Vote-derived placeholder "bills" (a motion to proceed, a cloture vote, etc.) were created only
// to satisfy the old votes.bill_id foreign key. They carry this sponsor marker and should never
// appear in the bills directory -- they are procedural votes, not legislation.
export const VOTE_PLACEHOLDER_SPONSOR_ID = "federal-vote-pending";

// State legislation is not synced yet (the OpenStates cron only pulls legislators and votes, not
// bills) -- the directory is federal-only until that pipeline exists. See bill_directory_facets
// for the matching scope on the dropdown facets.
function buildStoredBillsPageFilterQuery(filters: Omit<StoredBillsPageQuery, "page" | "pageSize" | "sortBy">) {
  const congressSession = `${getDefaultCongress()}th Congress`;
  const conditions = [
    `jurisdiction_type.eq.federal`,
    `session.eq.${congressSession}`,
    `sponsor_id.neq.${VOTE_PLACEHOLDER_SPONSOR_ID}`,
  ];

  if (filters.chamber && filters.chamber !== "Both") {
    conditions.push(`chamber.eq.${filters.chamber}`);
  }

  if (filters.status && filters.status !== "All statuses") {
    conditions.push(`status.eq.${filters.status}`);
  }

  if (filters.session && filters.session !== "All sessions") {
    conditions.push(`session.eq.${filters.session}`);
  }

  if (filters.topic && filters.topic !== "All topics") {
    conditions.push(`topic.eq.${filters.topic}`);
  }

  if (filters.sponsor && filters.sponsor !== "Any sponsor") {
    conditions.push(`sponsor_name.eq.${filters.sponsor}`);
  }

  if (filters.committee && filters.committee !== "Any committee") {
    conditions.push(`committee_name.eq.${filters.committee}`);
  }

  const normalizedQuery = (filters.query || "").trim();
  if (normalizedQuery) {
    const escaped = escapeIlikeValue(normalizedQuery);
    // `search_text` is a generated column concatenating number/title/topic/sponsor/committee,
    // backed by a GIN trigram index. The previous five separate ILIKE predicates each forced
    // their own sequential scan.
    conditions.push(`search_text.ilike.*${escaped}*`);
  }

  return `and=${encodeURIComponent(`(${conditions.join(",")})`)}`;
}

function buildStoredBillsOrder(sortBy?: string) {
  if (sortBy === "Bill number") {
    return "order=number.asc";
  }

  if (sortBy === "Title") {
    return "order=title.asc";
  }

  // last_action_at is a display string ("Mar 4, 2025"), so ordering by it sorts alphabetically
  // -- September 2025 above June 2026. last_action_on is the parsed timestamptz.
  return "order=last_action_on.desc.nullslast";
}

export async function listStoredBills(includeDetails = false) {
  const congressSession = `${getDefaultCongress()}th Congress`;
  const [federalBillRows, stateBillRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills", `jurisdiction_type=eq.federal&session=eq.${encodeURIComponent(congressSession)}`, {
      cache: "no-store",
      select: BILL_LIST_SELECT,
      paginateAll: true,
    }),
    fetchSupabaseRows<BillRow>("bills", "jurisdiction_type=eq.state", {
      cache: "no-store",
      select: BILL_LIST_SELECT,
      paginateAll: true,
    }),
  ]);
  const billRows = [...federalBillRows, ...stateBillRows];

  if (!includeDetails) {
    return sortBillsByActivity(
      billRows.map((row) => mapRowToBill(row, [], [])),
    );
  }

  const [actionRows, versionRows] = await Promise.all([
    listStoredBillActionRowsByBillIds(billRows.map((row) => row.id)),
    listStoredBillVersionRowsByBillIds(billRows.map((row) => row.id)),
  ]);

  const actionsByBillId = new Map<string, BillActionRow[]>();
  for (const row of actionRows) {
    const items = actionsByBillId.get(row.bill_id) || [];
    items.push(row);
    actionsByBillId.set(row.bill_id, items);
  }

  const versionsByBillId = new Map<string, BillVersionRow[]>();
  for (const row of versionRows) {
    const items = versionsByBillId.get(row.bill_id) || [];
    items.push(row);
    versionsByBillId.set(row.bill_id, items);
  }

  return sortBillsByActivity(
    billRows.map((row) => mapRowToBill(row, actionsByBillId.get(row.id) || [], versionsByBillId.get(row.id) || [])),
  );
}

export async function getStoredBillsPage(query: StoredBillsPageQuery) {
  const page = Math.max(1, query.page);
  const pageSize = Math.max(1, query.pageSize);
  const offset = (page - 1) * pageSize;
  const filters = buildStoredBillsPageFilterQuery(query);
  const order = buildStoredBillsOrder(query.sortBy);
  const pageResult = await fetchSupabasePage<BillRow>(
    "bills",
    [filters, order].filter(Boolean).join("&"),
    {
      select: BILL_LIST_SELECT,
      limit: pageSize,
      offset,
      // An exact count re-counts every matching row on each page view; the pager only needs
      // enough precision to draw page links.
      count: "planned",
      tags: [BILLS_CACHE_TAG],
    },
  );

  return {
    bills: pageResult.rows.map((row) => mapRowToBill(row, [], [])),
    total: pageResult.total,
  };
}

export interface BillDirectoryFacetRow {
  facet: string;
  value: string;
}

/**
 * Distinct dropdown values for the bills directory.
 *
 * This previously paged through every bill row (17.8k rows over 36 sequential requests, ~20s
 * measured, 4.4MB) and ran DISTINCT in JS. `bill_directory_facets` is a STABLE Postgres
 * function doing the GROUP BY server-side and returning ~640 rows, fetched over GET so the
 * result is cached.
 */
export async function listStoredBillDirectoryFacets() {
  const congressSession = `${getDefaultCongress()}th Congress`;
  return fetchSupabaseRpcRows<BillDirectoryFacetRow>(
    "bill_directory_facets",
    { p_session: congressSession },
    { tags: [BILLS_CACHE_TAG] },
  );
}

/**
 * Slug lookup for only the committees referenced by the bills on the current page, keyed by
 * both id and name (the directory matches on either). The bills page previously loaded the
 * entire committees table -- 562KB with select=* -- to resolve ~20 slugs.
 */
export async function getCommitteeSlugLookup(bills: Bill[]) {
  const ids = [...new Set(bills.map((bill) => bill.committeeId).filter(Boolean))];
  const names = [...new Set(bills.map((bill) => bill.committeeName).filter(Boolean))];

  if (ids.length === 0 && names.length === 0) {
    return {} as Record<string, string>;
  }

  const clauses = [
    ids.length > 0 ? `id.in.(${buildQuotedInFilter(ids)})` : "",
    names.length > 0 ? `name.in.(${buildQuotedInFilter(names)})` : "",
  ].filter(Boolean);

  const rows = await fetchSupabaseRows<{ id: string; name: string; slug: string }>(
    "committees",
    `or=(${clauses.join(",")})`,
    { select: "id,name,slug", tags: [COMMITTEES_CACHE_TAG] },
  );

  const lookup: Record<string, string> = {};
  for (const row of rows) {
    if (row.id) lookup[row.id] = row.slug;
    if (row.name) lookup[row.name] = row.slug;
  }

  return lookup;
}

const BILL_CARD_SELECT = [
  "id",
  "slug",
  "number",
  "title",
  "summary",
  "jurisdiction",
  "country",
  "state",
  "chamber",
  "status",
  "topic",
  "sponsor_id",
  "sponsor_name",
  "committee_id",
  "committee_name",
  "latest_action",
  "last_action_at",
  "introduced_at",
  "session",
  "chance_of_passing",
  "stats",
  "related_bill_ids",
  "source",
  "source_system",
  "source_id",
  "jurisdiction_type",
  "session_id",
  "synced_at",
].join(",");

/**
 * The handful of bills the dashboard actually renders.
 *
 * The dashboard previously called listStoredBills(), downloading every bill in the database
 * (~17.8k rows across ~71 sequential requests, measured at 24s) and then doing .slice(0, 4)
 * three times. These are ORDER BY ... LIMIT queries against the last_action_on index.
 */
export async function listRecentStoredBills(limit: number, statuses?: string[]) {
  const congressSession = `${getDefaultCongress()}th Congress`;
  const conditions = [
    `or(jurisdiction_type.eq.state,and(jurisdiction_type.eq.federal,session.eq.${congressSession}))`,
    `sponsor_id.neq.${VOTE_PLACEHOLDER_SPONSOR_ID}`,
  ];

  if (statuses?.length) {
    conditions.push(`status.in.(${buildQuotedInFilter(statuses)})`);
  }

  const rows = await fetchSupabaseRows<BillRow>(
    "bills",
    [
      `and=${encodeURIComponent(`(${conditions.join(",")})`)}`,
      "order=last_action_on.desc.nullslast",
      `limit=${limit}`,
    ].join("&"),
    { select: BILL_CARD_SELECT, tags: [BILLS_CACHE_TAG] },
  );

  return rows.map((row) => mapRowToBill(row, [], []));
}

export async function listStoredBillsByIds(billIds: string[], includeDetails = false) {
  if (billIds.length === 0) {
    return [];
  }

  const rows = await fetchSupabaseRows<BillRow>(
    "bills",
    `id=in.(${buildQuotedInFilter(billIds)})`,
    { cache: "no-store", select: BILL_LIST_SELECT, paginateAll: true },
  );

  if (!includeDetails) {
    return sortBillsByActivity(
      rows.map((row) => mapRowToBill(row, [], [])),
    );
  }

  const [actionRows, versionRows] = await Promise.all([
    listStoredBillActionRowsByBillIds(rows.map((row) => row.id)),
    listStoredBillVersionRowsByBillIds(rows.map((row) => row.id)),
  ]);

  const actionsByBillId = new Map<string, BillActionRow[]>();
  for (const row of actionRows) {
    const items = actionsByBillId.get(row.bill_id) || [];
    items.push(row);
    actionsByBillId.set(row.bill_id, items);
  }

  const versionsByBillId = new Map<string, BillVersionRow[]>();
  for (const row of versionRows) {
    const items = versionsByBillId.get(row.bill_id) || [];
    items.push(row);
    versionsByBillId.set(row.bill_id, items);
  }

  return sortBillsByActivity(
    rows.map((row) => mapRowToBill(row, actionsByBillId.get(row.id) || [], versionsByBillId.get(row.id) || [])),
  );
}

export async function listStoredBillsBySponsor(
  politicianId: string,
  politicianSlug?: string,
  politicianName?: string,
) {
  const normalizedName = (politicianName || "").replace(/"/g, '\\"');
  const filters = [
    `sponsor_id=eq.${encodeURIComponent(politicianId)}`,
    politicianSlug ? `sponsor_id=eq.${encodeURIComponent(politicianSlug)}` : "",
    normalizedName ? `sponsor_name=eq.${encodeURIComponent(normalizedName)}` : "",
  ].filter(Boolean);

  const rows = await fetchSupabaseRows<BillRow>(
    "bills",
    `or=(${filters.join(",")})`,
    { cache: "no-store", select: BILL_LIST_SELECT, paginateAll: true },
  );

  const uniqueRows = [...new Map(rows.map((row) => [row.id, row])).values()];
  return sortBillsByActivity(
    uniqueRows.map((row) => mapRowToBill(row, [], [])),
  );
}

const BILL_ACTION_SELECT = "bill_id,sort_order,date,label,detail,type";
const BILL_VERSION_METADATA_SELECT = "bill_id,version_id,sort_order,label,date,type,source_url,formats,is_full_text_available";

/**
 * `includeVersionContent` pulls bill_versions.content -- the full bill text. Only /bills/[id]/text
 * renders it; the overview, timeline and votes tabs were all downloading it via select=* and
 * throwing it away, along with the raw_bill / raw_payload JSONB blobs.
 */
export async function getStoredBillById(
  billId: string,
  options?: { includeVersionContent?: boolean },
) {
  const encodedId = encodeURIComponent(billId);
  const versionSelect = options?.includeVersionContent
    ? `${BILL_VERSION_METADATA_SELECT},content`
    : BILL_VERSION_METADATA_SELECT;

  const [billRows, actionRows, versionRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills", `id=eq.${encodedId}&limit=1`, {
      select: BILL_LIST_SELECT,
      tags: [BILLS_CACHE_TAG],
    }),
    fetchSupabaseRows<BillActionRow>("bill_actions", `bill_id=eq.${encodedId}&order=sort_order.asc`, {
      select: BILL_ACTION_SELECT,
      tags: [BILLS_CACHE_TAG],
      paginateAll: true,
    }),
    fetchSupabaseRows<BillVersionRow>("bill_versions", `bill_id=eq.${encodedId}&order=sort_order.asc`, {
      select: versionSelect,
      tags: [BILLS_CACHE_TAG],
      paginateAll: true,
    }),
  ]);

  const row = billRows[0];
  if (!row) return undefined;

  return mapRowToBill(
    row,
    actionRows,
    versionRows.map((version) => ({ ...version, content: version.content || [] })),
  );
}

export async function upsertStoredBills(rows: BillRow[]) {
  return upsertSupabaseRowsInChunks("bills", rows, "id", 25);
}

export async function listStoredBillActionRowsByBillIds(billIds: string[]) {
  if (billIds.length === 0) {
    return [] as BillActionRow[];
  }

  const chunkSize = 100;
  const rows: BillActionRow[] = [];
  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<BillActionRow>(
      "bill_actions",
      `bill_id=in.(${buildQuotedInFilter(chunk)})&order=bill_id.asc,sort_order.asc`,
      { cache: "no-store", paginateAll: true },
    );
    rows.push(...result);
  }

  return rows;
}

export async function listStoredBillVersionRowsByBillIds(billIds: string[]) {
  if (billIds.length === 0) {
    return [] as BillVersionRow[];
  }

  const chunkSize = 100;
  const rows: BillVersionRow[] = [];
  for (let index = 0; index < billIds.length; index += chunkSize) {
    const chunk = billIds.slice(index, index + chunkSize);
    const result = await fetchSupabaseRows<BillVersionRow>(
      "bill_versions",
      `bill_id=in.(${buildQuotedInFilter(chunk)})&order=bill_id.asc,sort_order.asc`,
      { cache: "no-store", paginateAll: true },
    );
    rows.push(...result);
  }

  return rows;
}

export async function replaceStoredBillActions(billIds: string[], rows: BillActionRow[]) {
  if (billIds.length > 0) {
    await deleteSupabaseRows("bill_actions", `bill_id=in.(${buildQuotedInFilter(billIds)})`);
  }

  if (rows.length === 0) {
    return [];
  }

  return upsertSupabaseRows("bill_actions", rows, "bill_id,sort_order");
}

export async function replaceStoredBillVersions(billIds: string[], rows: BillVersionRow[]) {
  if (billIds.length > 0) {
    await deleteSupabaseRows("bill_versions", `bill_id=in.(${buildQuotedInFilter(billIds)})`);
  }

  if (rows.length === 0) {
    return [];
  }

  return upsertSupabaseRows("bill_versions", rows, "bill_id,version_id");
}

export async function appendStoredBillActions(rows: BillActionRow[]) {
  if (rows.length === 0) {
    return [];
  }

  return upsertSupabaseRowsInChunks("bill_actions", rows, "bill_id,sort_order", 250);
}

export async function appendStoredBillVersions(rows: BillVersionRow[]) {
  if (rows.length === 0) {
    return [];
  }

  return upsertSupabaseRowsInChunks("bill_versions", rows, "bill_id,version_id", 250);
}
