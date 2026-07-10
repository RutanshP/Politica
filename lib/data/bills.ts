import { emptyResult, withData } from "@/lib/data/result";
import { getStoredBillById, listStoredBills } from "@/lib/supabase/bills";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import type { Bill } from "@/types/civic";

export type BillDataSource = "supabase" | "unconfigured" | "unavailable";

export async function getBillsData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", [] as Bill[], "unconfigured"),
      bills: [] as Bill[],
    };
  }

  try {
    const [bills, federalRun, stateRun] = await Promise.all([
      listStoredBills(),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      bills.length > 0 ? "supabase" : "unavailable",
      "federal_legislation_sync",
      bills,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: bills.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return {
      ...result,
      source: result.source as BillDataSource,
      bills,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", [] as Bill[], "unavailable", error instanceof Error ? error.message : "Stored bill read failed"),
      bills: [] as Bill[],
    };
  }
}

export async function getBillData(billId: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", undefined, "unconfigured"),
      bill: undefined,
    };
  }

  try {
    const [bill, latestRun] = await Promise.all([
      getStoredBillById(billId),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
    ]);
    const result = withData(
      bill ? "supabase" : "unavailable",
      "federal_legislation_sync",
      bill,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: bill ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return {
      ...result,
      source: result.source as BillDataSource,
      bill,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", undefined, "unavailable", error instanceof Error ? error.message : "Stored bill read failed"),
      bill: undefined,
    };
  }
}

export async function getBillRouteParams() {
  const { bills } = await getBillsData();
  return bills.map((bill) => ({ billId: bill.id }));
}

export function isLiveBillsSource(source: string) {
  return source === "supabase";
}

export function getBillsSourceLabel(source: string) {
  if (source === "supabase") return "Stored legislative data";
  if (source === "unconfigured") return "Supabase is not configured";
  return "Stored bill data unavailable";
}

export function getRecentlyPassedBills(bills: Bill[]) {
  return bills.filter((bill) => bill.status === "Passed Chamber" || bill.status === "Signed").slice(0, 4);
}
