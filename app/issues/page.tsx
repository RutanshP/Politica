import { EmptyState } from "@/components/empty-state";
import { IssuesDirectory } from "@/components/issues-directory";
import { PageHeader } from "@/components/page-header";
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
      <SectionCard
        title="Issue directory"
        description="Search by name or description, and sort by active bills, recent votes, or bipartisan support. Every issue links out to its connected bills, committees, and politicians."
      >
        {issues.length > 0 ? (
          <IssuesDirectory issues={issues} />
        ) : (
          <EmptyState
            title="No issue clusters available"
            description="Issue clustering is derived from live bill data, so it appears once legislative records are loaded."
            actionLabel="Open bills"
            actionHref="/bills"
          />
        )}
      </SectionCard>
    </div>
  );
}
