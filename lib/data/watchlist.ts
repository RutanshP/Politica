import { listRecentStoredBills } from "@/lib/supabase/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getIssuesData } from "@/lib/data/issues";
import { getPoliticiansData } from "@/lib/data/politicians";
import { withData } from "@/lib/data/result";
import { billHref } from "@/lib/utils";
import type { Bill, WatchlistItem } from "@/types/civic";

export type WatchlistDataSource = "supabase-derived" | "unconfigured" | "unavailable";

export async function getWatchlistData() {
  // The watchlist renders 2 bills, 2 politicians, 1 committee and 1 issue. Bills used to come
  // from getBillsData(), which downloads the entire bills table.
  const [bills, politiciansData, committeesData, issuesData] = await Promise.all([
    listRecentStoredBills(2).catch(() => [] as Bill[]),
    getPoliticiansData(),
    getCommitteesData(),
    getIssuesData(),
  ]);

  const items: WatchlistItem[] = [
    ...bills.map((bill) => ({
      id: `watch-${bill.id}`,
      label: `${bill.number} - ${bill.title}`,
      type: "bill" as const,
      lastUpdated: bill.lastActionAt,
      status: bill.status,
      href: billHref(bill.id),
    })),
    ...politiciansData.politicians.slice(0, 2).map((politician) => ({
      id: `watch-${politician.id}`,
      label: politician.name,
      type: "politician" as const,
      lastUpdated: politician.nextElection,
      status: `${politician.stats.billsIntroduced} bills introduced`,
      href: `/politicians/${politician.slug}`,
    })),
    ...committeesData.committees.slice(0, 1).map((committee) => ({
      id: `watch-${committee.id}`,
      label: committee.name,
      type: "committee" as const,
      lastUpdated: committee.hearing,
      status: `${committee.activeBillIds.length} linked bills`,
      href: `/committees/${committee.slug}`,
    })),
    ...issuesData.issues.slice(0, 1).map((issue) => ({
      id: `watch-${issue.id}`,
      label: issue.name,
      type: "issue" as const,
      lastUpdated: `${issue.stats.recentVotes} recent votes`,
      status: `${issue.stats.activeBills} active bills`,
      href: `/issues/${issue.slug}`,
    })),
  ];

  const hasData = items.length > 0;
  const allSources = [
    politiciansData.source,
    committeesData.source,
    issuesData.source,
  ];

  const source = hasData
    ? ("supabase-derived" as WatchlistDataSource)
    : allSources.every((item) => item === "unconfigured")
      ? ("unconfigured" as WatchlistDataSource)
      : ("unavailable" as WatchlistDataSource);

  const result = withData(
    source,
    "watchlist_seed",
    items,
    [politiciansData.freshness.syncedAt, committeesData.freshness.syncedAt, issuesData.freshness.syncedAt]
      .filter(Boolean)
      .sort()
      .at(-1),
    {
      availability: hasData ? "live" : source === "unconfigured" ? "unconfigured" : "empty",
      detail: "App-level watchlist generated from stored entities",
    },
  );

  return {
    ...result,
    source,
    items,
  };
}
