import { emptyResult, withData } from "@/lib/data/result";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";
import { getStoredIssueBySlug, listStoredIssues } from "@/lib/supabase/issues";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import type { Issue } from "@/types/civic";

export type IssueDataSource = "supabase" | "unconfigured" | "unavailable";

export async function getIssuesData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "issue_rebuild", [] as Issue[], "unconfigured"),
      issues: [] as Issue[],
    };
  }

  try {
    const [issues, latestRun] = await Promise.all([
      listStoredIssues(),
      getLatestSyncRun("issue_rebuild").catch(() => undefined),
    ]);
    const result = withData(
      issues.length > 0 ? "supabase" : "unavailable",
      "issue_rebuild",
      issues,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: issues.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No issue rebuild history yet",
      },
    );
    return {
      ...result,
      source: result.source as IssueDataSource,
      issues,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "issue_rebuild", [] as Issue[], "unavailable", error instanceof Error ? error.message : "Stored issue read failed"),
      issues: [] as Issue[],
    };
  }
}

export async function getIssueData(slug: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "issue_rebuild", undefined, "unconfigured"),
      source: "unconfigured" as IssueDataSource,
      issue: undefined,
    };
  }

  try {
    const [issue, latestRun] = await Promise.all([
      getStoredIssueBySlug(slug),
      getLatestSyncRun("issue_rebuild").catch(() => undefined),
    ]);
    const result = withData(
      issue ? "supabase" : "unavailable",
      "issue_rebuild",
      issue,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: issue ? "live" : "empty",
        detail: latestRun?.status ? `Latest rebuild status: ${latestRun.status}` : "No issue rebuild history yet",
      },
    );
    return { ...result, source: result.source as IssueDataSource, issue };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "issue_rebuild", undefined, "unavailable", error instanceof Error ? error.message : "Stored issue read failed"),
      source: "unavailable" as IssueDataSource,
      issue: undefined,
    };
  }
}

export async function getIssueRouteParams() {
  const { issues } = await getIssuesData();
  return issues.map((issue) => ({ slug: issue.slug }));
}

export async function getIssueViewData(slug: string) {
  const [{ issue, source, freshness, availability, error }, { bills }, { committees }, { politicians }] = await Promise.all([
    getIssueData(slug),
    import("@/lib/data/bills").then((module) => module.getBillsData()),
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
    freshness,
    availability,
    error,
    issue,
    issueBills,
    issueCommittees,
    topPoliticians,
  };
}

export function getIssueSourceLabel(source: string) {
  if (source === "supabase") return "Stored issue clusters";
  if (source === "unconfigured") return "Supabase is not configured";
  return "Stored issue data unavailable";
}

export function isLiveIssueSource(source: string) {
  return source === "supabase";
}
