import { emptyResult, withData } from "@/lib/data/result";
import {
  getStoredCommitteeBySlug,
  listStoredCommitteeMemberships,
  listStoredCommitteeMembershipsByCommitteeId,
  listStoredCommittees,
  mergeCommitteeMembershipIds,
} from "@/lib/supabase/committees";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import type { Committee } from "@/types/civic";

export type CommitteeDataSource = "supabase" | "unconfigured" | "unavailable";

export async function getCommitteesData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", [] as Committee[], "unconfigured"),
      committees: [] as Committee[],
    };
  }

  try {
    const [committees, memberships, federalRun, stateRun] = await Promise.all([
      listStoredCommittees(),
      listStoredCommitteeMemberships().catch(() => []),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const mergedCommittees = mergeCommitteeMembershipIds(committees, memberships);
    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      mergedCommittees.length > 0 ? "supabase" : "unavailable",
      "federal_legislation_sync",
      mergedCommittees,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: mergedCommittees.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as CommitteeDataSource, committees: mergedCommittees };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", [] as Committee[], "unavailable", error instanceof Error ? error.message : "Stored committee read failed"),
      committees: [] as Committee[],
    };
  }
}

export async function getCommitteeData(slug: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", undefined, "unconfigured"),
      committee: undefined,
    };
  }

  try {
    const [committee, memberships, federalRun, stateRun] = await Promise.all([
      getStoredCommitteeBySlug(slug),
      getStoredCommitteeBySlug(slug).then((item) =>
        item ? listStoredCommitteeMembershipsByCommitteeId(item.id).catch(() => []) : []),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const mergedCommittee = committee
      ? mergeCommitteeMembershipIds([committee], memberships)[0]
      : undefined;
    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      mergedCommittee ? "supabase" : "unavailable",
      "federal_legislation_sync",
      mergedCommittee,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: mergedCommittee ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as CommitteeDataSource, committee: mergedCommittee };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", undefined, "unavailable", error instanceof Error ? error.message : "Stored committee read failed"),
      committee: undefined,
    };
  }
}

export async function getCommitteeRouteParams() {
  const { committees } = await getCommitteesData();
  return committees.map((committee) => ({ slug: committee.slug }));
}

export function getCommitteeSourceLabel(source: string) {
  if (source === "supabase") return "Stored committee data";
  if (source === "unconfigured") return "Supabase is not configured";
  return "Stored committee data unavailable";
}

export function isLiveCommitteeSource(source: string) {
  return source === "supabase";
}
