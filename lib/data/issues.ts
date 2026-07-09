import { getBillsData } from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";
import { slugifySegment } from "@/lib/utils";
import type { Issue } from "@/types/civic";

export type IssueDataSource = "live-derived" | "unconfigured" | "unavailable";

export async function getIssuesData() {
  const { bills, source } = await getBillsData();

  if (source === "unconfigured") {
    return {
      source: "unconfigured" as IssueDataSource,
      issues: [] as Issue[],
    };
  }

  if (source !== "live-congress") {
    return {
      source: "unavailable" as IssueDataSource,
      issues: [] as Issue[],
    };
  }

  const byTopic = new Map<string, typeof bills>();
  for (const bill of bills) {
    const existing = byTopic.get(bill.topic) || [];
    existing.push(bill);
    byTopic.set(bill.topic, existing);
  }

  const issues: Issue[] = [...byTopic.entries()].map(([topic, topicBills]) => ({
    id: slugifySegment(topic),
    slug: slugifySegment(topic),
    name: topic,
    description: `Live issue cluster derived from Congress.gov bills tagged to ${topic}.`,
    stats: {
      activeBills: topicBills.length,
      recentVotes: topicBills.reduce((sum, bill) => sum + bill.stats.votes, 0),
      bipartisanSupport:
        Math.round(
          topicBills.reduce((sum, bill) => sum + bill.stats.bipartisanScore, 0) / Math.max(topicBills.length, 1),
        ) || 0,
    },
    topBillIds: topicBills.slice(0, 4).map((bill) => bill.id),
    committeeIds: [...new Set(topicBills.map((bill) => slugifySegment(bill.committeeName)))],
  }));

  return {
    source: "live-derived" as IssueDataSource,
    issues,
  };
}

export async function getIssueData(slug: string) {
  const { issues, source } = await getIssuesData();
  return {
    source,
    issue: issues.find((issue) => issue.slug === slug),
  };
}

export async function getIssueRouteParams() {
  const { issues } = await getIssuesData();
  return issues.map((issue) => ({ slug: issue.slug }));
}

export async function getIssueViewData(slug: string) {
  const [{ issue, source }, { bills }, { committees }, { politicians }] = await Promise.all([
    getIssueData(slug),
    getBillsData(),
    getCommitteesData(),
    getPoliticiansData(),
  ]);

  const issueBills = issue ? bills.filter((bill) => issue.topBillIds.includes(bill.id)) : [];
  const issueCommittees = committees.filter((committee) => issue?.committeeIds.includes(committee.slug));
  const topPoliticians = politicians
    .filter((politician) => issueBills.some((bill) => bill.sponsorId === politician.id || bill.sponsorName === politician.name))
    .slice(0, 5);

  return {
    source,
    issue,
    issueBills,
    issueCommittees,
    topPoliticians,
  };
}

export function getIssueSourceLabel(source: IssueDataSource) {
  if (source === "live-derived") return "Live issue clusters";
  if (source === "unconfigured") return "Congress.gov API not configured";
  return "Issue data unavailable";
}

export function isLiveIssueSource(source: IssueDataSource) {
  return source === "live-derived";
}
