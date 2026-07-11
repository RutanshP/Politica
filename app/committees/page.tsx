import { CommitteesDirectory } from "@/components/committees-directory";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getCommitteeSourceLabel,
  getCommitteesData,
  isLiveCommitteeSource,
} from "@/lib/data/committees";

export const revalidate = 21600;

export default async function CommitteesPage() {
  const { committees, source } = await getCommitteesData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Committees"
        title="Committee explorer"
        description="Browse committees by chamber, sector, jurisdiction, active bills, and hearing context."
        actions={
          <SourceBadge
            label={getCommitteeSourceLabel(source)}
            live={isLiveCommitteeSource(source)}
          />
        }
      />
      <SectionCard title="Committee directory">
        {committees.length > 0 ? (
          <CommitteesDirectory committees={committees} />
        ) : (
          <EmptyState
            title="No committee data available"
            description="Connect the Congress.gov API or wait for the next successful sync to populate committee metadata."
            actionLabel="Open bills"
            actionHref="/bills"
          />
        )}
      </SectionCard>
    </div>
  );
}
