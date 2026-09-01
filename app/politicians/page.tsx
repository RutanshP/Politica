import { PageHeader } from "@/components/page-header";
import { PoliticiansDirectory } from "@/components/politicians-directory";
import { SourceBadge } from "@/components/source-badge";
import { Tag } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
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
    Object.entries(resolvedSearchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const { politicians, source, total, page, pageSize, needsState, filters, options } =
    await getPoliticiansDirectoryData(normalizedSearchParams);

  const activeFilters = [
    `Level: ${filters.level}`,
    filters.level === "State" && filters.state ? `State: ${filters.state}` : null,
    filters.office && !filters.office.startsWith("All") ? `Chamber: ${filters.office}` : null,
    filters.party && !filters.party.startsWith("All") ? `Party: ${filters.party}` : null,
    filters.query ? `Search: ${filters.query}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div>
      <PageHeader
        title="Politicians"
        description="Member profiles with connected voting behavior, funding, committees, and sponsored legislation."
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />

      <WithRail
        rail={
          <>
            <Card>
              <CardHeader title="Current filter" />
              <CardBody>
                <p className="num text-2xl font-semibold tracking-[-0.02em] text-[var(--accent-2)]">
                  {total.toLocaleString()}
                </p>
                <p className="text-[11.5px] text-[var(--faint)]">
                  {total === 1 ? "member matches" : "members match"}
                </p>
                <div className="mt-3.5 flex flex-wrap gap-1.5">
                  {activeFilters.map((label) => (
                    <Tag key={label}>{label}</Tag>
                  ))}
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="About the photos" />
              <CardNote>
                Headshots load from the public bioguide image set, keyed on each member&apos;s ID.
                Governors and members without a photo fall back to an initials tile.
              </CardNote>
            </Card>
          </>
        }
      >
        <PoliticiansDirectory
          politicians={politicians}
          needsState={needsState}
          total={total}
          page={page}
          pageSize={pageSize}
          filters={filters}
          options={options}
        />
      </WithRail>
    </div>
  );
}
