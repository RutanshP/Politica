import { emptyResult, withData } from "@/lib/data/result";
import { getStoredCommitteeBySlug, listStoredCommittees } from "@/lib/supabase/committees";
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
    const committees = await listStoredCommittees();
    const latestRun = await getLatestSyncRun("federal_legislation_sync").catch(() => undefined);
    const result = withData(
      committees.length > 0 ? "supabase" : "unavailable",
      "federal_legislation_sync",
      committees,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: committees.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as CommitteeDataSource, committees };
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
    const committee = await getStoredCommitteeBySlug(slug);
    const latestRun = await getLatestSyncRun("federal_legislation_sync").catch(() => undefined);
    const result = withData(
      committee ? "supabase" : "unavailable",
      "federal_legislation_sync",
      committee,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: committee ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as CommitteeDataSource, committee };
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
