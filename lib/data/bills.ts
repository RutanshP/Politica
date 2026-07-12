import { emptyResult, withData } from "@/lib/data/result";
import { getStoredBillById, getStoredBillsPage, listStoredBillDirectoryFacets, listStoredBills } from "@/lib/supabase/bills";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { sortLabelsAlphabetically } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export type BillDataSource = "supabase" | "unconfigured" | "unavailable";
export const BILL_DIRECTORY_PAGE_SIZE = 20;

export interface BillsDirectorySearchParams {
  page?: string;
  q?: string;
  level?: string;
  state?: string;
  chamber?: string;
  status?: string;
  session?: string;
  topic?: string;
  sponsor?: string;
  committee?: string;
  sort?: string;
}

function parsePositiveInt(value?: string, fallback = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

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

export async function getBillsDirectoryData(searchParams: BillsDirectorySearchParams) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", [] as Bill[], "unconfigured"),
      bills: [] as Bill[],
      total: 0,
      page: 1,
      pageSize: BILL_DIRECTORY_PAGE_SIZE,
      filters: {
        query: "",
        level: "All levels",
        state: "All states",
        chamber: "Both",
        status: "All statuses",
        session: "All sessions",
        topic: "All topics",
        sponsor: "Any sponsor",
        committee: "Any committee",
        sortBy: "Recent activity",
      },
      options: {
        levels: ["All levels"],
        states: ["All states"],
        chambers: ["Both"],
        statuses: ["All statuses"],
        sessions: ["All sessions"],
        topics: ["All topics"],
        sponsors: ["Any sponsor"],
        committees: ["Any committee"],
        sortOptions: ["Recent activity", "Bill number", "Title", "Level"],
      },
    };
  }

  const page = parsePositiveInt(searchParams.page, 1);
  const filters = {
    query: (searchParams.q || "").trim(),
    level: searchParams.level || "All levels",
    state: searchParams.state || "All states",
    chamber: searchParams.chamber || "Both",
    status: searchParams.status || "All statuses",
    session: searchParams.session || "All sessions",
    topic: searchParams.topic || "All topics",
    sponsor: searchParams.sponsor || "Any sponsor",
    committee: searchParams.committee || "Any committee",
    sortBy: searchParams.sort || "Recent activity",
  };

  try {
    const [{ bills, total }, facetRows, federalRun, stateRun] = await Promise.all([
      getStoredBillsPage({
        page,
        pageSize: BILL_DIRECTORY_PAGE_SIZE,
        query: filters.query,
        level: filters.level,
        state: filters.state,
        chamber: filters.chamber,
        status: filters.status,
        session: filters.session,
        topic: filters.topic,
        sponsor: filters.sponsor,
        committee: filters.committee,
        sortBy: filters.sortBy,
      }),
      listStoredBillDirectoryFacets().catch(() => []),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);

    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];

    const options = {
      levels: ["All levels", ...sortLabelsAlphabetically(facetRows.map((row) => row.jurisdiction_type === "state" ? "State" : "Federal"))],
      states: ["All states", ...sortLabelsAlphabetically(facetRows.map((row) => row.state).filter(Boolean) as string[])],
      chambers: ["Both", ...sortLabelsAlphabetically(facetRows.map((row) => row.chamber))],
      statuses: ["All statuses", ...sortLabelsAlphabetically(facetRows.map((row) => row.status))],
      sessions: ["All sessions", ...sortLabelsAlphabetically(facetRows.map((row) => row.session))],
      topics: ["All topics", ...sortLabelsAlphabetically(facetRows.map((row) => row.topic))],
      sponsors: ["Any sponsor", ...sortLabelsAlphabetically(facetRows.map((row) => row.sponsor_name))],
      committees: ["Any committee", ...sortLabelsAlphabetically(facetRows.map((row) => row.committee_name))],
      sortOptions: ["Recent activity", "Bill number", "Title", "Level"],
    };

    const result = withData(
      total > 0 ? "supabase" : "unavailable",
      "federal_legislation_sync",
      bills,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: total > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );

    return {
      ...result,
      source: result.source as BillDataSource,
      bills,
      total,
      page,
      pageSize: BILL_DIRECTORY_PAGE_SIZE,
      filters,
      options,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", [] as Bill[], "unavailable", error instanceof Error ? error.message : "Stored bill read failed"),
      bills: [] as Bill[],
      total: 0,
      page,
      pageSize: BILL_DIRECTORY_PAGE_SIZE,
      filters,
      options: {
        levels: ["All levels"],
        states: ["All states"],
        chambers: ["Both"],
        statuses: ["All statuses"],
        sessions: ["All sessions"],
        topics: ["All topics"],
        sponsors: ["Any sponsor"],
        committees: ["Any committee"],
        sortOptions: ["Recent activity", "Bill number", "Title", "Level"],
      },
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
    const [bill, federalRun, stateRun] = await Promise.all([
      getStoredBillById(billId),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      bill ? "supabase" : "unavailable",
      latestRun?.pipeline || "federal_legislation_sync",
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
