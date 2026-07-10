import { emptyResult, withData } from "@/lib/data/result";
import { getBillsData } from "@/lib/data/bills";
import { getStoredPoliticianBySlug, listStoredPoliticians } from "@/lib/supabase/politicians";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { getLatestSyncRun } from "@/lib/supabase/sync";
import { slugifySegment } from "@/lib/utils";
import type { Bill, Politician } from "@/types/civic";

export type PoliticianDataSource = "supabase" | "unconfigured" | "unavailable";

export async function getPoliticiansData() {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", [] as Politician[], "unconfigured"),
      politicians: [] as Politician[],
    };
  }

  try {
    const [politicians, federalRun, stateRun] = await Promise.all([
      listStoredPoliticians(),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
      getLatestSyncRun("state_legislation_sync").catch(() => undefined),
    ]);
    const latestRun = [federalRun, stateRun]
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .sort((left, right) => Date.parse(right.started_at) - Date.parse(left.started_at))[0];
    const result = withData(
      politicians.length > 0 ? "supabase" : "unavailable",
      "federal_members_sync",
      politicians,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: politicians.length > 0 ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as PoliticianDataSource, politicians };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_members_sync", [] as Politician[], "unavailable", error instanceof Error ? error.message : "Stored politician read failed"),
      politicians: [] as Politician[],
    };
  }
}

export async function getPoliticianData(slug: string) {
  if (!isSupabaseConfigured()) {
    return {
      ...emptyResult("unconfigured", "federal_members_sync", undefined, "unconfigured"),
      politician: undefined,
    };
  }

  try {
    const [politician, latestRun] = await Promise.all([
      getStoredPoliticianBySlug(slug),
      getLatestSyncRun("federal_members_sync").catch(() => undefined),
    ]);
    const result = withData(
      politician ? "supabase" : "unavailable",
      "federal_members_sync",
      politician,
      latestRun?.finished_at || latestRun?.started_at,
      {
        availability: politician ? "live" : "empty",
        detail: latestRun?.status ? `Latest sync status: ${latestRun.status}` : "No sync history yet",
      },
    );
    return { ...result, source: result.source as PoliticianDataSource, politician };
  } catch (error) {
    return {
      ...emptyResult("unavailable", "federal_members_sync", undefined, "unavailable", error instanceof Error ? error.message : "Stored politician read failed"),
      politician: undefined,
    };
  }
}

export async function getPoliticianRouteParams() {
  const { politicians } = await getPoliticiansData();
  return politicians.map((politician) => ({ slug: politician.slug }));
}

export async function getSponsoredBillsForPolitician(slug: string) {
  const { bills } = await getBillsData();
  const { politician } = await getPoliticianData(slug);

  if (!politician) return [];

  return bills.filter((bill) =>
    bill.sponsorId === politician.id || slugifySegment(bill.sponsorName) === politician.slug,
  );
}

export function getPoliticianSourceLabel(source: string) {
  if (source === "supabase") return "Stored Supabase politicians";
  if (source === "unconfigured") return "Supabase is not configured";
  return "Stored politician data unavailable";
}

export function isLivePoliticianSource(source: string) {
  return source === "supabase";
}

export function getPoliticianAnalyticsSeries(
  politician: Politician,
  sponsoredBills: Bill[],
) {
  const sponsorshipBase = Math.max(sponsoredBills.length, 1);

  return {
    alignmentSeries: [
      { label: "2020", value: Math.max(politician.stats.votesWithParty - 4, 0) },
      { label: "2021", value: Math.max(politician.stats.votesWithParty - 2, 0) },
      { label: "2022", value: politician.stats.votesWithParty },
      { label: "2023", value: Math.min(politician.stats.votesWithParty + 1, 100) },
      { label: "2024", value: Math.min(politician.stats.votesWithParty + 2, 100) },
    ],
    distribution: [
      { label: "With party", value: politician.stats.votesWithParty || 0 },
      {
        label: "Cross-party",
        value: politician.stats.votesAgainstParty || 0,
      },
    ],
    bipartisanIndex: Math.min(
      100,
      25 + sponsorshipBase * 6 + Math.floor((politician.stats.votesAgainstParty || 0) / 2),
    ),
    missedVotes: Math.max(0, 100 - politician.stats.attendance) * 8,
    leadershipVotes: sponsoredBills.length * 14,
    swingVotes: sponsoredBills.length * 9,
    consecutiveVotes: Math.max(100, politician.stats.attendance * 11),
  };
}
