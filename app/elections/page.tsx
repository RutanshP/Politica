import { ElectionsDirectory } from "@/components/elections-directory";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { getElectionsDirectoryData, getElectionsSourceLabel, isLiveElectionsSource } from "@/lib/data/elections";

export const revalidate = 21600;

export default async function ElectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const normalizedSearchParams = Object.fromEntries(
    Object.entries(resolvedSearchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const { races, source, filters, options } = await getElectionsDirectoryData(normalizedSearchParams);
  const live = isLiveElectionsSource(source);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Elections"
        title="Federal candidates"
        description="Who's running for President, Senate, and House -- party, incumbent/challenger status, and links to sitting officeholders."
        actions={<SourceBadge label={getElectionsSourceLabel(source)} live={live} />}
      />
      <ElectionsDirectory races={races} filters={filters} options={options} />
    </div>
  );
}
