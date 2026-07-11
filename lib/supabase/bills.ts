import { mapRowToBill, sortBillsByActivity } from "@/lib/normalizers/legislation";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
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

export async function listStoredBills() {
  const [billRows, actionRows, versionRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills", undefined, {
      cache: "no-store",
      select: BILL_LIST_SELECT,
    }),
    fetchSupabaseRows<BillActionRow>("bill_actions", "order=bill_id.asc,sort_order.asc"),
    fetchSupabaseRows<BillVersionRow>("bill_versions", "order=bill_id.asc,sort_order.asc"),
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

export async function getStoredBillById(billId: string) {
  const [billRows, actionRows, versionRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills", `id=eq.${encodeURIComponent(billId)}&limit=1`),
    fetchSupabaseRows<BillActionRow>("bill_actions", `bill_id=eq.${encodeURIComponent(billId)}&order=sort_order.asc`),
    fetchSupabaseRows<BillVersionRow>("bill_versions", `bill_id=eq.${encodeURIComponent(billId)}&order=sort_order.asc`),
  ]);

  const row = billRows[0];
  return row ? mapRowToBill(row, actionRows, versionRows) : undefined;
}

export async function upsertStoredBills(rows: BillRow[]) {
  return upsertSupabaseRowsInChunks("bills", rows, "id", 25);
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
