import { notFound } from "next/navigation";

import { CongressNetwork } from "@/components/congress-network/congress-network";
import { EmptyState } from "@/components/empty-state";
import { FundingStatTiles } from "@/components/funding/funding-stat-tiles";
import { MoneyFlowDiagram } from "@/components/funding/money-flow";
import { LobbiedBillsCard } from "@/components/lobbying/lobbied-bills-card";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { buildMoneyFlow } from "@/lib/graph/build-money-flow";
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

  // State officials file with their state, not the FEC, so there is no federal money to trace.
  const isFederal = politician.jurisdictionType !== "state";
  const [flow, lobbiedBills] = await Promise.all([
    buildMoneyFlow(slug, filters, { includeLobbying: isFederal }),
    isFederal ? getMostLobbiedBills({ sponsorId: politician.id, limit: 8 }) : [],
  ]);
  if (!flow) notFound();

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
      <FundingStatTiles totals={flow.totals} cycleLabel={flow.cycleLabel} />
      {/*
        Two different views, in the order a reader needs them. The diagram answers "who paid this
        member, and what did they sponsor" from this member's own filings. The network below
        answers "who else did those donors pay", which is only meaningful once you have the first.
      */}
      {isFederal ? (
        <>
          <MoneyFlowDiagram flow={flow} />
          <CongressNetwork initialFocus={`m:${politician.id}`} variant="embedded" />
        </>
      ) : (
        <EmptyState
          title="Not in the Congress money network"
          description="State officials file with their state, not the FEC, so there are no federal PAC gifts to show for them."
        />
      )}
      <LobbiedBillsCard
        title="Lobbying on bills they sponsored"
        rows={lobbiedBills}
        note="Organizations that named each bill in their Lobbying Disclosure Act reports this Congress. Lobbying on a bill is not money to its sponsor."
      />
    </div>
  );
}
