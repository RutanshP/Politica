import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getIssueSourceLabel,
  getIssuesData,
  isLiveIssueSource,
} from "@/lib/data/issues";

export const revalidate = 21600;

export default async function IssuesPage() {
  const { issues, source } = await getIssuesData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Issues"
        title="Issue explorer"
        description="Track issue areas like AI, technology, immigration, taxes, and healthcare across their connected bills, committees, and politicians."
        actions={
          <SourceBadge
            label={getIssueSourceLabel(source)}
            live={isLiveIssueSource(source)}
          />
        }
      />
      <SectionCard title="Filters" description="Issue pages stay interconnected so every bill, politician, and committee remains clickable.">
        <FilterBar
          filters={[
            { label: "Search", value: "All issues", options: ["All issues"] },
            { label: "Activity", value: "All activity", options: ["All activity", "High activity", "New activity"] },
            { label: "Support", value: "All support levels", options: ["All support levels", "High bipartisan support", "Mixed support"] },
            { label: "Votes", value: "All vote counts", options: ["All vote counts"] },
          ]}
        />
      </SectionCard>
      <SectionCard title="Issue directory">
        {issues.length > 0 ? (
          <DataTable
            columns={["Issue", "Description", "Active bills", "Recent votes", "Bipartisan support"]}
            rows={issues.map((issue) => [
              <Link key={issue.id} href={`/issues/${issue.slug}`} className="font-semibold text-[var(--accent-2)]">
                {issue.name}
              </Link>,
              issue.description,
              issue.stats.activeBills,
              issue.stats.recentVotes,
              `${issue.stats.bipartisanSupport}%`,
            ])}
          />
        ) : (
          <EmptyState
            title="No issue clusters available"
            description="Issue clustering is derived from live bill data, so it appears once legislative records are loaded."
            actionLabel="Open bills"
            actionHref="/bills"
          />
        )}
      </SectionCard>
      <Pagination page={1} pageSize={issues.length || 1} total={issues.length} />
    </div>
  );
}
