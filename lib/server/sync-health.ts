import "server-only";

import { SYNC_CACHE_TAG } from "@/lib/supabase/cache-tags";
import { fetchSupabaseRows } from "@/lib/supabase/rest";

/*
 * Whether the scheduled syncs are actually working -- not just whether they returned 200.
 *
 * Two failures went unnoticed for weeks in 2026 because every run reported "success": the House
 * stock-disclosure and amendment-text syncs could not load pdf.js on Vercel, so each run marked
 * every PDF extract_failed and wrote nothing new. The nightly workflow calls this last and fails
 * when it reports a problem, and a failed scheduled workflow is what GitHub emails the owner about.
 */

const HOUR = 3_600_000;

/** How long each scheduled pipeline may go without a successful run. Nightly ones get a missed night of slack. */
const EXPECTED: Record<string, number> = {
  federal_members_sync: 36,
  federal_legislation_sync: 36,
  bill_amendment_links: 36,
  executive_sync: 36,
  stock_disclosure_sync: 36,
  stock_performance_sync: 36,
  fec_funding_graph_sync: 36,
  pac_contributions_sync: 36,
  lobbying_filings_sync: 36,
  news_sync: 60,
  election_candidates_sync: 8 * 24 + 12,
  search_rebuild: 8 * 24 + 12,
  issue_rebuild: 8 * 24 + 12,
  analytics_rebuild: 8 * 24 + 12,
  lobbying_graph_rebuild: 8 * 24 + 12,
};

/** What each pipeline keeps current, in words a reader of the site would use. */
export const PIPELINE_LABELS: Record<string, string> = {
  federal_legislation_sync: "Bills, actions and roll-call votes",
  federal_members_sync: "Members of Congress",
  bill_amendment_links: "Amendments and their text",
  executive_sync: "President, Vice President and governors",
  stock_disclosure_sync: "Members' stock trades",
  stock_performance_sync: "Stock trade performance",
  fec_funding_graph_sync: "Campaign fundraising (FEC)",
  pac_contributions_sync: "PAC contributions",
  lobbying_filings_sync: "Lobbying reports",
  news_sync: "News",
  election_candidates_sync: "2026 candidates",
  search_rebuild: "Search index",
  issue_rebuild: "Issue pages",
  analytics_rebuild: "Analytics",
  lobbying_graph_rebuild: "Lobbying links in member funding graphs",
};

export interface SyncHealthIssue {
  pipeline: string;
  kind: "stale" | "silent-failure" | "behind" | "latest-failed";
  detail: string;
}

interface RunRow {
  pipeline: string;
  status: string;
  started_at: string;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
}

const get = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Record<string, unknown>)[key] : undefined), value);

/**
 * Checks on what a "successful" run wrote. Each returns a problem description, or null.
 * Kept to signals that mean something is broken rather than merely quiet.
 */
const SILENT_CHECKS: Partial<Record<string, (metadata: Record<string, unknown>) => string | null>> = {
  stock_disclosure_sync: (metadata) => {
    const failed = Number(get(metadata, ["byStatus", "extract_failed"])) || 0;
    // One malformed PDF is the filer's problem; several at once is ours.
    return failed >= 5 ? `${failed} filings could not be read (${String(get(metadata, ["errors", "0"]) ?? "see sync_runs")})` : null;
  },
  bill_amendment_links: (metadata) => {
    const failed = Number(get(metadata, ["textFailures", "extractionError"])) || 0;
    return failed >= 5 ? `${failed} amendment PDFs failed to extract: ${String(metadata.firstTextError ?? "unknown error")}` : null;
  },
  pac_contributions_sync: (metadata) => {
    const failures = get(metadata, ["failures"]);
    const count = Array.isArray(failures) ? failures.length : 0;
    const synced = Number(metadata.membersSynced) || 0;
    return count > 0 && synced === 0 ? `every member failed (${count}), e.g. ${JSON.stringify(failures && (failures as unknown[])[0]).slice(0, 160)}` : null;
  },
  fec_funding_graph_sync: (metadata) => {
    const failures = get(metadata, ["failures"]);
    const count = Array.isArray(failures) ? failures.length : 0;
    const synced = Number(metadata.politiciansSynced) || 0;
    return count > 0 && synced === 0 ? `every member failed (${count})` : null;
  },
};

/**
 * `cached` reads through the sync cache tag, which every sync route invalidates when it writes --
 * for the public status page. The workflow check reads uncached.
 */
export async function checkSyncHealth(options: { now?: number; cached?: boolean } = {}) {
  const now = options.now ?? Date.now();
  const since = new Date(now - 9 * 24 * HOUR).toISOString();
  const runs = await fetchSupabaseRows<RunRow>(
    "sync_runs",
    `started_at=gte.${encodeURIComponent(since)}&order=started_at.desc`,
    {
      ...(options.cached ? { tags: [SYNC_CACHE_TAG] } : { cache: "no-store" as const }),
      paginateAll: true,
      select: "pipeline,status,started_at,error_message,metadata",
    },
  );

  const issues: SyncHealthIssue[] = [];
  const warnings: SyncHealthIssue[] = [];

  for (const [pipeline, maxAgeHours] of Object.entries(EXPECTED)) {
    const own = runs.filter((run) => run.pipeline === pipeline);
    const lastSuccess = own.find((run) => run.status === "success");
    const ageHours = lastSuccess ? (now - Date.parse(lastSuccess.started_at)) / HOUR : Infinity;

    if (ageHours > maxAgeHours) {
      const lastError = own.find((run) => run.status === "failed" && !/superseded/i.test(run.error_message ?? ""));
      issues.push({
        pipeline,
        kind: "stale",
        detail: lastSuccess
          ? `no successful run for ${Math.round(ageHours)}h (expected within ${maxAgeHours}h)${lastError ? `; last error: ${lastError.error_message?.slice(0, 200)}` : ""}`
          : `no successful run in 9 days${lastError ? `; last error: ${lastError.error_message?.slice(0, 200)}` : own.length === 0 ? "; it has not run at all" : ""}`,
      });
      continue;
    }

    const latest = own.find((run) => run.status !== "running" && !/superseded/i.test(run.error_message ?? ""));
    if (latest && latest.status === "failed") {
      warnings.push({ pipeline, kind: "latest-failed", detail: latest.error_message?.slice(0, 200) ?? "failed" });
    }

    const check = SILENT_CHECKS[pipeline];
    const problem = check && lastSuccess?.metadata ? check(lastSuccess.metadata) : null;
    if (problem) issues.push({ pipeline, kind: "silent-failure", detail: problem });
  }

  // The lobbying cursor should reach the present; three days behind means the nightly slices are not keeping up.
  const lobbying = runs.find((run) => run.pipeline === "lobbying_filings_sync" && run.status === "success");
  const cursor = lobbying?.metadata ? Date.parse(String(lobbying.metadata.nextPostedAfter ?? "")) : NaN;
  if (lobbying && lobbying.metadata?.done === false && Number.isFinite(cursor) && now - cursor > 3 * 24 * HOUR) {
    issues.push({
      pipeline: "lobbying_filings_sync",
      kind: "behind",
      detail: `cursor is at ${new Date(cursor).toISOString().slice(0, 10)}; raise LOBBYING_CHUNKS for a run to catch up`,
    });
  }

  const lastSuccessAt = Object.fromEntries(
    Object.keys(EXPECTED).map((pipeline) => [
      pipeline,
      runs.find((run) => run.pipeline === pipeline && run.status === "success")?.started_at ?? null,
    ]),
  );

  return { ok: issues.length === 0, checkedAt: new Date(now).toISOString(), issues, warnings, lastSuccessAt };
}
