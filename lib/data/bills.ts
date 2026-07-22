import { cache } from "react";

import { emptyResult, withData } from "@/lib/data/result";
import {
  getStoredBillById,
  getStoredBillsPage,
  listRecentStoredBills,
  listStoredBillDirectoryFacets,
  listStoredBills,
  type BillDirectoryFacetRow,
} from "@/lib/supabase/bills";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { sortLabelsAlphabetically } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export type BillDataSource = "supabase" | "unconfigured" | "unavailable";
export const BILL_DIRECTORY_PAGE_SIZE = 20;

export interface BillsDirectorySearchParams {
  page?: string;
  q?: string;
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

/** Corpus-wide aggregates for the bills directory rail. See getBillsDirectoryData. */
export interface BillCorpusSummary {
  total: number;
  byStatus: Array<{ value: string; total: number }>;
  topTopics: Array<{ value: string; total: number }>;
}

const EMPTY_CORPUS: BillCorpusSummary = { total: 0, byStatus: [], topTopics: [] };

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
        chamber: "Both",
        status: "All statuses",
        session: "All sessions",
        topic: "All topics",
        sponsor: "Any sponsor",
        committee: "Any committee",
        sortBy: "Recent activity",
      },
      options: {
        chambers: ["Both"],
        statuses: ["All statuses"],
        sessions: ["All sessions"],
        topics: ["All topics"],
        sponsors: ["Any sponsor"],
        committees: ["Any committee"],
        sortOptions: ["Recent activity", "Bill number", "Title"],
      },
      corpus: EMPTY_CORPUS,
    };
  }

  const page = parsePositiveInt(searchParams.page, 1);
  const filters = {
    query: (searchParams.q || "").trim(),
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
        chamber: filters.chamber,
        status: filters.status,
        session: filters.session,
        topic: filters.topic,
        sponsor: filters.sponsor,
        committee: filters.committee,
        sortBy: filters.sortBy,
      }),
      listStoredBillDirectoryFacets().catch(() => [] as BillDirectoryFacetRow[]),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);

    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];

    // Postgres already grouped these; the rows arrive pre-deduplicated and sorted.
    const facetValues = (facet: string) =>
      facetRows.filter((row) => row.facet === facet).map((row) => row.value);

    const options = {
      chambers: ["Both", ...sortLabelsAlphabetically(facetValues("chamber"))],
      statuses: ["All statuses", ...sortLabelsAlphabetically(facetValues("status"))],
      sessions: ["All sessions", ...sortLabelsAlphabetically(facetValues("session"))],
      topics: ["All topics", ...sortLabelsAlphabetically(facetValues("topic"))],
      sponsors: ["Any sponsor", ...sortLabelsAlphabetically(facetValues("sponsor"))],
      committees: ["Any committee", ...sortLabelsAlphabetically(facetValues("committee"))],
      sortOptions: ["Recent activity", "Bill number", "Title"],
    };

    /*
     * Aggregates for the directory rail. These are counts over the entire federal bill set from
     * the facets RPC, deliberately independent of the current filter -- the rail is a map of the
     * corpus ("what is in here"), not a restatement of the result count already in the toolbar.
     */
    const facetCounts = (facet: string) =>
      facetRows
        .filter((row) => row.facet === facet && typeof row.total === "number")
        .map((row) => ({ value: row.value, total: row.total as number }))
        .sort((left, right) => right.total - left.total);

    const statusCounts = facetCounts("status");
    const corpus = {
      total: statusCounts.reduce((sum, row) => sum + row.total, 0),
      byStatus: statusCounts,
      topTopics: facetCounts("topic").slice(0, 6),
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
      corpus,
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
        chambers: ["Both"],
        statuses: ["All statuses"],
        sessions: ["All sessions"],
        topics: ["All topics"],
        sponsors: ["Any sponsor"],
        committees: ["Any committee"],
        sortOptions: ["Recent activity", "Bill number", "Title"],
      },
      corpus: EMPTY_CORPUS,
    };
  }
}

export async function getBillData(billId: string, options?: { includeVersionContent?: boolean }) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", undefined, "unconfigured"),
      bill: undefined,
    };
  }

  try {
    const [bill, federalRun, stateRun] = await Promise.all([
      getStoredBillById(billId, options),
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

/**
 * The 12 bills the dashboard renders, as three LIMITed queries instead of a full-table download.
 */
export const getDashboardBills = cache(async () => {
  if (!isSupabaseConfigured()) {
    return { trending: [] as Bill[], recentlyPassed: [] as Bill[], upcomingVotes: [] as Bill[], source: "unconfigured" as BillDataSource };
  }

  try {
    const [trending, recentlyPassed, upcomingVotes] = await Promise.all([
      listRecentStoredBills(4),
      listRecentStoredBills(4, ["Passed Chamber", "Signed"]),
      listRecentStoredBills(4, ["On Floor", "Passed Chamber"]),
    ]);

    return {
      trending,
      recentlyPassed,
      upcomingVotes,
      source: (trending.length > 0 ? "supabase" : "unavailable") as BillDataSource,
    };
  } catch {
    return { trending: [] as Bill[], recentlyPassed: [] as Bill[], upcomingVotes: [] as Bill[], source: "unavailable" as BillDataSource };
  }
});

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
