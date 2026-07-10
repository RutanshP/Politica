import { notFound } from "next/navigation";

import { DataTable } from "@/components/data-table";
import { NetworkGraph } from "@/components/network-graph";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getGraphSourceLabel,
  getFundingGraphData,
  isLiveGraphSource,
} from "@/lib/data/graph";
import {
  getPoliticianData,
  getPoliticianRouteParams,
  getPoliticianSourceLabel,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export async function generateStaticParams() {
  return getPoliticianRouteParams();
}

export const revalidate = 21600;

export default async function PoliticianFundingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const { graph, source: graphSource } = await getFundingGraphData(slug);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Funding relationships"
        title={politician.name}
        description="Centered funding view for this politician, with campaign committees and finance sources arranged around the member."
        actions={
          <>
            <SourceBadge
              label={getPoliticianSourceLabel(source)}
              live={isLivePoliticianSource(source)}
            />
            <SourceBadge
              label={getGraphSourceLabel(graphSource)}
              live={isLiveGraphSource(graphSource)}
            />
          </>
        }
      />
      <PoliticianTabs slug={politician.slug} active="funding" />
      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SectionCard title="Funding filters">
          <div className="space-y-3 text-sm">
            {[
              "Election cycle: current",
              "Center node: selected politician",
              "Jurisdiction: Federal",
              "Relationship: campaign funding",
              "Top sources: highest receipts first",
              "Fallback mode: stored Congress links if FEC match is missing",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Funding network">
          <NetworkGraph nodes={graph.nodes} edges={graph.edges} focusNodeId={politician.slug} />
        </SectionCard>
        <SectionCard title="Connected sources">
          <DataTable
            columns={["Source", "Target", "Amount", "Type"]}
            rows={graph.edges.map((edge) => [
              graph.nodes.find((node) => node.id === edge.source)?.label || edge.source,
              graph.nodes.find((node) => node.id === edge.target)?.label || edge.target,
              edge.amount ? `$${edge.amount.toLocaleString()}` : "Context edge",
              edge.label,
            ])}
          />
        </SectionCard>
      </section>
    </div>
  );
}
