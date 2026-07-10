import { PageHeader } from "@/components/page-header";
import { PoliticiansDirectory } from "@/components/politicians-directory";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getPoliticianSourceLabel,
  getPoliticiansData,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export const revalidate = 21600;

export default async function PoliticiansPage() {
  const { politicians, source } = await getPoliticiansData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Politicians"
        title="Profiles and legislative behavior"
        description="Browse member snapshots with connected access to voting behavior, funding, committees, bills, biography, and issue activity."
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <SectionCard title="Member directory" description="Search, filter, and sort the stored member records.">
        <PoliticiansDirectory politicians={politicians} />
      </SectionCard>
    </div>
  );
}
