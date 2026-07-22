import { CommitteesDirectory } from "@/components/committees-directory";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
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
    <div>
      <PageHeader
        title="Committees"
        description="Browse committees by level, chamber, sector, membership, and hearing activity."
        actions={
          <SourceBadge
            label={getCommitteeSourceLabel(source)}
            live={isLiveCommitteeSource(source)}
          />
        }
      />
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
    </div>
  );
}
