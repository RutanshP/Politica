import { BillsDirectory } from "@/components/bills-directory";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getBillsDirectoryData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { getCommitteeSlugLookup } from "@/lib/supabase/bills";

export const revalidate = 21600;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const normalizedSearchParams = Object.fromEntries(
    Object.entries(resolvedSearchParams).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );
  const { bills, source, total, page, pageSize, filters, options } =
    await getBillsDirectoryData(normalizedSearchParams);
  // Only the committees referenced by the 20 bills on this page, rather than the whole table.
  const committeeSlugs = await getCommitteeSlugLookup(bills).catch(() => ({} as Record<string, string>));
  const live = isLiveBillsSource(source);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bills explorer"
        title="Explore legislation"
        description="Search and filter legislation across chambers, committees, sponsors, sessions, and issue clusters."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <SectionCard title="Bills table" description="Every row links deeper into the bill, committee, and sponsor profile.">
        <BillsDirectory
          bills={bills}
          committeeSlugs={committeeSlugs}
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
