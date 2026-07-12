import { PageHeader } from "@/components/page-header";
import { PoliticiansDirectory } from "@/components/politicians-directory";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getPoliticianSourceLabel,
  getPoliticiansDirectoryData,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export const revalidate = 21600;

export default async function PoliticiansPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const normalizedSearchParams = Object.fromEntries(
    Object.entries(resolvedSearchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const { politicians, source, total, page, pageSize, filters, options } = await getPoliticiansDirectoryData(normalizedSearchParams);

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
        <PoliticiansDirectory
          politicians={politicians}
          total={total}
          page={page}
          pageSize={pageSize}
          filters={filters}
          options={options}
        />
      </SectionCard>
    </div>
  );
}
