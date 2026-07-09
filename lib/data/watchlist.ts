import { getBillsData } from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getIssuesData } from "@/lib/data/issues";
import { getPoliticiansData } from "@/lib/data/politicians";
import type { WatchlistItem } from "@/types/civic";

export type WatchlistDataSource = "live-derived" | "unconfigured" | "unavailable";

export async function getWatchlistData() {
  const [billsData, politiciansData, committeesData, issuesData] = await Promise.all([
    getBillsData(),
    getPoliticiansData(),
    getCommitteesData(),
    getIssuesData(),
  ]);

  const items: WatchlistItem[] = [
    ...billsData.bills.slice(0, 2).map((bill) => ({
      id: `watch-${bill.id}`,
      label: `${bill.number} - ${bill.title}`,
      type: "bill" as const,
      lastUpdated: bill.lastActionAt,
      status: bill.status,
      href: `/bills/${bill.id}`,
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
    billsData.source,
    politiciansData.source,
    committeesData.source,
    issuesData.source,
  ];

  return {
    source: hasData
      ? ("live-derived" as WatchlistDataSource)
      : allSources.every((item) => item === "unconfigured")
        ? ("unconfigured" as WatchlistDataSource)
        : ("unavailable" as WatchlistDataSource),
    items,
  };
}
