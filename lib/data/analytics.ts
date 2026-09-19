import { emptyResult, withData } from "@/lib/data/result";
import { getBillsData } from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getAnalyticsSnapshot } from "@/lib/supabase/analytics";
import { getLatestSyncRun } from "@/lib/supabase/sync";

type SeriesPoint = { label: string; value: number };

export type AnalyticsDataSource = "supabase" | "supabase-derived" | "unconfigured" | "unavailable";

export type AnalyticsSummary = Awaited<ReturnType<typeof computeAnalyticsSummary>>;

/*
 * Bumped whenever the summary's shape or meaning changes. A stored snapshot with any other version
 * is ignored and the summary is computed live instead, so a deploy never renders a snapshot the
 * current code does not understand. Version 1 had no field at all -- that snapshot was frozen at
 * 1,000 bills and 0 committees because the rebuild re-saved whatever was already stored.
 */
export const ANALYTICS_SNAPSHOT_VERSION = 2;

const MONTHS_SHOWN = 12;

/**
 * Bills introduced per calendar month, oldest first, ending at the latest month on record.
 *
 * Keyed by year and month. Keying on the month name alone merged every January in the corpus
 * into one bucket and emitted buckets in first-seen order, which is why the chart ran backwards.
 * Months with no introductions are filled with zero rather than skipped.
 */
function buildMonthlySeries(values: string[]): SeriesPoint[] {
  const counts = new Map<number, number>();
  for (const value of values) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const key = date.getUTCFullYear() * 12 + date.getUTCMonth();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  if (counts.size === 0) return [];

  const latest = Math.max(...counts.keys());
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const series: SeriesPoint[] = [];
  for (let key = latest - MONTHS_SHOWN + 1; key <= latest; key += 1) {
    const date = new Date(Date.UTC(Math.floor(key / 12), key % 12, 1));
    series.push({ label: formatter.format(date), value: counts.get(key) || 0 });
  }
  return series;
}

function countByStatus(bills: Array<{ status: string }>, status: string) {
  return bills.filter((bill) => bill.status === status).length;
}

export async function computeAnalyticsSummary() {
  const [billsData, committeesData, politiciansData] = await Promise.all([
    getBillsData(),
    getCommitteesData(),
    getPoliticiansData(),
  ]);
  const { bills } = billsData;

  const activitySeries = (["Introduced", "In Committee", "On Floor", "Passed Chamber", "Signed"] as const)
    .map((status) => ({
      label: status === "In Committee" ? "Committee" : status === "On Floor" ? "Floor" : status === "Passed Chamber" ? "Passed" : status,
      value: countByStatus(bills, status),
    }));

  const introductionsSeries = buildMonthlySeries(
    bills.map((bill) =>
      bill.introducedAt === "Unknown" || bill.introducedAt === "Not available"
        ? bill.lastActionAt
        : bill.introducedAt,
    ),
  );

  // Party-line voting, averaged over members who have actually cast recorded votes. Governors and
  // members with no roll calls on file carry 0/0 and would drag both averages toward zero.
  const voters = politiciansData.politicians.filter(
    (politician) => politician.stats.votesWithParty + politician.stats.votesAgainstParty > 0,
  );
  const average = (pick: (value: (typeof voters)[number]) => number) =>
    voters.length === 0 ? 0 : Math.round(voters.reduce((sum, item) => sum + pick(item), 0) / voters.length);

  return {
    version: ANALYTICS_SNAPSHOT_VERSION,
    activeBills: bills.length,
    upcomingVotes: bills.filter((bill) =>
      bill.status === "On Floor"
      || bill.status === "Passed Chamber"
      || bill.status === "Sent to President",
    ).length,
    enacted: countByStatus(bills, "Signed"),
    committees: committeesData.committees.length,
    activitySeries,
    introductionsSeries,
    partisanSeries: voters.length === 0
      ? []
      : [
          { label: "With party", value: average((item) => item.stats.votesWithParty) },
          { label: "Against party", value: average((item) => item.stats.votesAgainstParty) },
        ],
  };
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  version: ANALYTICS_SNAPSHOT_VERSION,
  activeBills: 0,
  upcomingVotes: 0,
  enacted: 0,
  committees: 0,
  activitySeries: [],
  introductionsSeries: [],
  partisanSeries: [],
};

function isCurrentSnapshot(payload: unknown): payload is AnalyticsSummary {
  return Boolean(payload)
    && typeof payload === "object"
    && (payload as { version?: unknown }).version === ANALYTICS_SNAPSHOT_VERSION;
}

export async function getAnalyticsData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "analytics_rebuild", EMPTY_SUMMARY, "unconfigured"),
      source: "unconfigured" as AnalyticsDataSource,
      summary: EMPTY_SUMMARY,
    };
  }

  const [snapshot, latestRun] = await Promise.all([
    getAnalyticsSnapshot("dashboard-summary").catch(() => undefined),
    getLatestSyncRun("analytics_rebuild").catch(() => undefined),
  ]);

  if (isCurrentSnapshot(snapshot?.payload)) {
    const summary = snapshot.payload;
    const result = withData(
      "supabase",
      "analytics_rebuild",
      summary,
      snapshot.synced_at || latestRun?.finished_at || latestRun?.started_at,
      {
        availability: "live",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "Stored analytics snapshot",
      },
    );

    return {
      ...result,
      source: "supabase" as AnalyticsDataSource,
      summary,
    };
  }

  const summary = await computeAnalyticsSummary();
  const result = withData(
    "supabase-derived",
    "analytics_rebuild",
    summary,
    latestRun?.finished_at || latestRun?.started_at,
    {
      availability: summary.activeBills > 0 ? "partial" : "empty",
      detail: "Computed live because no current stored snapshot exists",
    },
  );

  return {
    ...result,
    source: "supabase-derived" as AnalyticsDataSource,
    summary,
  };
}
