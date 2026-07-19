import { notFound } from "next/navigation";

import { FundingNetworkExplorer } from "@/components/funding/funding-network-explorer";
import { FundingStatTiles } from "@/components/funding/funding-stat-tiles";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { buildPoliticianFundingGraph } from "@/lib/graph/build-politician-funding-graph";
import { parseFundingGraphQuery } from "@/lib/graph/funding-graph-params";
import {
  getPoliticianData,
  getPoliticianSourceLabel,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import { DEFAULT_FUNDING_GRAPH_FILTERS } from "@/types/funding-graph";

export const revalidate = 21600;

export default async function PoliticianFundingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, rawSearchParams] = await Promise.all([params, searchParams]);
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawSearchParams)) {
    if (typeof value === "string") urlParams.set(key, value);
  }
  const parsed = parseFundingGraphQuery(urlParams);
  const filters = parsed.ok ? parsed.filters : DEFAULT_FUNDING_GRAPH_FILTERS;

  const graph = await buildPoliticianFundingGraph(slug, filters);
  if (!graph) notFound();

  const cycleLabel = filters.cycle
    ? `${filters.cycle} cycle`
    : graph.availableFilters.cycles.length > 0
      ? `${graph.availableFilters.cycles.join(" + ")} cycles`
      : "No cycle data yet";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funding network"
        title={politician.name}
        description={`${politician.title} · ${politician.party} · ${politician.district || politician.state}. Documented funding, organizational, lobbying, and legislative relationships around this member.`}
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <PoliticianTabs slug={politician.slug} active="funding" />
      <FundingStatTiles totals={graph.totals} cycleLabel={cycleLabel} />
      <FundingNetworkExplorer slug={slug} initialGraph={graph} initialFilters={filters} />
    </div>
  );
}
