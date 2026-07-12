import { getDefaultCongress } from "@/lib/adapters/congress";
import { mapRowToBill, sortBillsByActivity } from "@/lib/normalizers/legislation";
import { deleteSupabaseRows, fetchSupabasePage, fetchSupabaseRows, upsertSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
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
  level?: string;
  state?: string;
  chamber?: string;
  status?: string;
  session?: string;
  topic?: string;
  sponsor?: string;
  committee?: string;
  sortBy?: string;
}

function buildStoredBillsPageFilterQuery(filters: Omit<StoredBillsPageQuery, "page" | "pageSize" | "sortBy">) {
  const congressSession = `${getDefaultCongress()}th Congress`;
  const conditions = [`or(jurisdiction_type.eq.state,and(jurisdiction_type.eq.federal,session.eq.${congressSession}))`];

  if (filters.level === "Federal") {
    conditions.push(`jurisdiction_type.eq.federal`);
    conditions.push(`session.eq.${congressSession}`);
  } else if (filters.level === "State") {
    conditions.push("jurisdiction_type.eq.state");
  }

  if (filters.state && filters.state !== "All states") {
    conditions.push(`state.eq.${filters.state}`);
  }

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
    conditions.push(`or(number.ilike.*${escaped}*,title.ilike.*${escaped}*,topic.ilike.*${escaped}*,sponsor_name.ilike.*${escaped}*,committee_name.ilike.*${escaped}*)`);
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

  if (sortBy === "Level") {
    return "order=jurisdiction_type.asc,state.asc,number.asc";
  }

  return "order=last_action_at.desc";
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
    },
  );

  return {
    bills: pageResult.rows.map((row) => mapRowToBill(row, [], [])),
    total: pageResult.total,
  };
}

export async function listStoredBillDirectoryFacets() {
  const congressSession = `${getDefaultCongress()}th Congress`;
  const rows = await fetchSupabaseRows<Pick<BillRow, "session" | "topic" | "sponsor_name" | "committee_name" | "state" | "chamber" | "status" | "jurisdiction_type">>(
    "bills",
    `or=${encodeURIComponent(`(and(jurisdiction_type.eq.federal,session.eq.${congressSession}),jurisdiction_type.eq.state)`)}`,
    {
      select: "session,topic,sponsor_name,committee_name,state,chamber,status,jurisdiction_type",
      paginateAll: true,
      pageSize: 500,
    },
  );

  return rows;
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

export async function getStoredBillById(billId: string) {
  const [billRows, actionRows, versionRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills", `id=eq.${encodeURIComponent(billId)}&limit=1`, { cache: "no-store" }),
    fetchSupabaseRows<BillActionRow>("bill_actions", `bill_id=eq.${encodeURIComponent(billId)}&order=sort_order.asc`, { cache: "no-store", paginateAll: true }),
    fetchSupabaseRows<BillVersionRow>("bill_versions", `bill_id=eq.${encodeURIComponent(billId)}&order=sort_order.asc`, { cache: "no-store", paginateAll: true }),
  ]);

  const row = billRows[0];
  return row ? mapRowToBill(row, actionRows, versionRows) : undefined;
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
