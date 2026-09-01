import { emptyResult, withData } from "@/lib/data/result";
import { getBillData } from "@/lib/data/bills";
import { listStoredVotesByBillId, listStoredVotesByPoliticianId } from "@/lib/supabase/votes";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import type { Vote } from "@/types/civic";

export type VoteDataSource = "supabase" | "partial" | "unconfigured" | "unavailable";

export async function getVotesDataForBill(billId: string) {
  const emptyVotes: Vote[] = [];
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", emptyVotes, "unconfigured"),
      source: "unconfigured" as VoteDataSource,
      votes: emptyVotes,
    };
  }

  try {
    const [{ bill }, latestRun] = await Promise.all([
      getBillData(billId),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
    ]);
    const votes = await listStoredVotesByBillId(billId);

    if (!bill) {
      return {
        ...emptyResult("unavailable", latestRun?.pipeline || "federal_legislation_sync", emptyVotes, "empty"),
        source: "unavailable" as VoteDataSource,
        votes: emptyVotes,
      };
    }

    const source = votes.length > 0 ? "supabase" : "partial";
    const result = withData(
      source,
      latestRun?.pipeline || "federal_legislation_sync",
      votes,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: votes.length > 0 ? "live" : "partial",
        detail: votes.length > 0
          ? "Stored vote records available"
          : "Bill exists but vote records are not stored yet",
      },
    );
    return {
      ...result,
      source: source as VoteDataSource,
      votes,
    };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", emptyVotes, "unavailable", error instanceof Error ? error.message : "Stored vote read failed"),
      source: "unavailable" as VoteDataSource,
      votes: emptyVotes,
    };
  }
}

export async function getVotesDataForPolitician(politicianId: string) {
  const emptyVotes: Vote[] = [];
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_legislation_sync", emptyVotes, "unconfigured"),
      source: "unconfigured" as VoteDataSource,
      votes: emptyVotes,
    };
  }

  try {
    const [votes, latestRun] = await Promise.all([
      listStoredVotesByPoliticianId(politicianId),
      getLatestSyncRun("federal_legislation_sync").catch(() => undefined),
    ]);
    const source = votes.length > 0 ? "supabase" : "partial";
    const result = withData(
      source,
      latestRun?.pipeline || "federal_legislation_sync",
      votes,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: votes.length > 0 ? "live" : "partial",
        detail: votes.length > 0
          ? "Stored politician vote records available"
          : "Politician vote records are not stored yet",
      },
    );
    return { ...result, source: source as VoteDataSource, votes };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_legislation_sync", emptyVotes, "unavailable", error instanceof Error ? error.message : "Stored politician vote read failed"),
      source: "unavailable" as VoteDataSource,
      votes: emptyVotes,
    };
  }
}

export function getVoteSourceLabel(source: string) {
  if (source === "supabase") {
    return "Stored vote records";
  }
  if (source === "partial") return "Bill stored, vote records incomplete";

  return source === "unconfigured"
    ? "Supabase is not configured"
    : "Vote data unavailable";
}

export function isLiveVoteSource(source: string) {
  return source === "supabase";
}
