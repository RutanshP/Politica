import { mapRowToBill, sortBillsByActivity } from "@/lib/normalizers/legislation";
import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows, upsertSupabaseRowsInChunks } from "@/lib/supabase/rest";
import type { BillActionRow, BillRow, BillVersionRow } from "@/types/supabase";

function buildQuotedInFilter(values: string[]) {
  return values
    .map((value) => `"${value.replace(/"/g, '\\"')}"`)
    .join(",");
}

export async function listStoredBills() {
  const [billRows, actionRows, versionRows] = await Promise.all([
    fetchSupabaseRows<BillRow>("bills"),
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
