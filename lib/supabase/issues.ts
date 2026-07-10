import { deleteSupabaseRows, fetchSupabaseRows, upsertSupabaseRows } from "@/lib/supabase/rest";
import type { Issue } from "@/types/civic";
import type { IssueBillLinkRow, IssueRow } from "@/types/supabase";

function mapRowToIssue(row: IssueRow): Issue {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    stats: row.stats,
    topBillIds: row.top_bill_ids,
    committeeIds: row.committee_ids,
    sourceMetadata: {
      sourceSystem: row.source_system,
      sourceId: row.source_id,
      syncedAt: row.synced_at,
      rawAvailable: Boolean(row.raw_payload),
    },
  };
}

export async function listStoredIssues() {
  const rows = await fetchSupabaseRows<IssueRow>("issues", "order=name.asc");
  return rows.map(mapRowToIssue);
}

export async function getStoredIssueBySlug(slug: string) {
  const rows = await fetchSupabaseRows<IssueRow>(
    "issues",
    `slug=eq.${encodeURIComponent(slug)}&limit=1`,
  );
  const row = rows[0];
  return row ? mapRowToIssue(row) : undefined;
}

export async function replaceStoredIssues(issueRows: IssueRow[], linkRows: IssueBillLinkRow[]) {
  await deleteSupabaseRows("issue_bill_links", "issue_id=not.is.null");
  await deleteSupabaseRows("issues", "id=not.is.null");

  const issues = issueRows.length > 0 ? await upsertSupabaseRows("issues", issueRows, "id") : [];
  if (linkRows.length > 0) {
    await upsertSupabaseRows("issue_bill_links", linkRows, "issue_id,bill_id");
  }
  return issues;
}
