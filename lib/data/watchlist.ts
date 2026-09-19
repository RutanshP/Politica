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

  /*
   * Suggestions should follow what is moving. Taking the first stored rows meant alphabetical
   * order -- Aaron Bean, Abraham Hamadeh, and a commission with 0 linked bills -- for everyone.
   */
  const recentSponsorIds = new Set(bills.map((bill) => bill.sponsorId));
  const suggestedPoliticians = [
    ...politiciansData.politicians.filter((politician) => recentSponsorIds.has(politician.id)),
    ...[...politiciansData.politicians].sort(
      (left, right) => right.stats.billsIntroduced - left.stats.billsIntroduced,
    ),
  ].filter((politician, index, list) => list.findIndex((other) => other.id === politician.id) === index);
  const busiestCommittee = [...committeesData.committees]
    .filter((committee) => !committee.isChamberRecord)
    .sort((left, right) => right.activeBillIds.length - left.activeBillIds.length);
  const busiestIssue = [...issuesData.issues].sort(
    (left, right) => right.stats.activeBills - left.stats.activeBills,
  );

  const items: WatchlistItem[] = [
    ...bills.map((bill) => ({
      id: `watch-${bill.id}`,
      label: `${bill.number} - ${bill.title}`,
      type: "bill" as const,
      lastUpdated: bill.lastActionAt,
      status: bill.status,
      href: billHref(bill.id),
    })),
    ...suggestedPoliticians.slice(0, 2).map((politician) => ({
      id: `watch-${politician.id}`,
      label: politician.name,
      type: "politician" as const,
      lastUpdated: politician.nextElection,
      status: `${politician.stats.billsIntroduced} bills introduced`,
      href: `/politicians/${politician.slug}`,
    })),
    ...busiestCommittee.slice(0, 1).map((committee) => ({
      id: `watch-${committee.id}`,
      label: committee.name,
      type: "committee" as const,
      lastUpdated: committee.hearing,
      status: `${committee.activeBillIds.length} linked bills`,
      href: `/committees/${committee.slug}`,
    })),
    ...busiestIssue.slice(0, 1).map((issue) => ({
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
