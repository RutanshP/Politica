import { notFound } from "next/navigation";

import { CongressNetwork } from "@/components/congress-network/congress-network";
import { EmptyState } from "@/components/empty-state";
import { FundingStatTiles } from "@/components/funding/funding-stat-tiles";
import { LobbiedBillsCard } from "@/components/lobbying/lobbied-bills-card";
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
import { getMostLobbiedBills } from "@/lib/data/lobbying";
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

  const [graph, lobbiedBills] = await Promise.all([
    buildPoliticianFundingGraph(slug, filters),
    politician.jurisdictionType === "state" ? [] : getMostLobbiedBills({ sponsorId: politician.id, limit: 8 }),
  ]);
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
        description={`${politician.title} · ${politician.party} · ${politician.district || politician.state}. Campaign totals, and every PAC that funded this member this cycle — click any dot to follow the money.`}
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <PoliticianTabs slug={politician.slug} active="funding" />
      <FundingStatTiles totals={graph.totals} cycleLabel={cycleLabel} />
      {/*
        The same network as /money/graph, opened on this member: their PAC donors fan out around
        them and the members they share the most donors with are lit. Clicking anything moves the
        focus, so the tab is a starting point into the whole network rather than a dead end.
      */}
      {politician.jurisdictionType === "state" ? (
        <EmptyState
          title="Not in the Congress money network"
          description="State officials file with their state, not the FEC, so there are no federal PAC gifts to show for them."
        />
      ) : (
        <CongressNetwork initialFocus={`m:${politician.id}`} variant="embedded" />
      )}
      <LobbiedBillsCard
        title="Lobbying on bills they sponsored"
        rows={lobbiedBills}
        note="Organizations that named each bill in their Lobbying Disclosure Act reports this Congress. Lobbying on a bill is not money to its sponsor."
      />
    </div>
  );
}
