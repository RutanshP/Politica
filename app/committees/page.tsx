import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
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
        description="Browse committees by chamber, jurisdiction, active bills, and upcoming hearing context."
        actions={
          <SourceBadge
            label={getCommitteeSourceLabel(source)}
            live={isLiveCommitteeSource(source)}
          />
        }
      />
      <SectionCard title="Filters" description="Prepared for chamber, issue, hearing, and leadership filtering.">
        <FilterBar
          filters={[
            { label: "Search", value: "All committees", options: ["All committees"] },
            { label: "Chamber", value: "All chambers", options: ["All chambers", ...new Set(committees.map((committee) => committee.chamber))] },
            { label: "Jurisdiction", value: "All jurisdictions", options: ["All jurisdictions"] },
            { label: "Upcoming hearings", value: "Any hearing status", options: ["Any hearing status", "Hearing scheduled", "No hearing"] },
          ]}
        />
      </SectionCard>
      <SectionCard title="Committee directory">
        {committees.length > 0 ? (
          <DataTable
            columns={["Committee", "Chamber", "Jurisdiction", "Active bills", "Upcoming hearing"]}
            rows={committees.map((committee) => [
              <Link key={committee.id} href={`/committees/${committee.slug}`} className="font-semibold text-[var(--accent)]">
                {committee.name}
              </Link>,
              committee.chamber,
              committee.jurisdiction,
              committee.activeBillIds.length,
              committee.hearing,
            ])}
          />
        ) : (
          <EmptyState
            title="No committee data available"
            description="Connect the Congress.gov API or wait for the next successful sync to populate committee metadata."
            actionLabel="Open bills"
            actionHref="/bills"
          />
        )}
      </SectionCard>
      <Pagination page={1} pageSize={committees.length || 1} total={committees.length} />
    </div>
  );
}
