import { notFound } from "next/navigation";

import { DataTable } from "@/components/data-table";
import { NetworkGraph } from "@/components/network-graph";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
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
        description="Networked view of live sponsorship relationships now, with deeper finance edges ready for FEC and lobbying ingestion next."
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
      <Tabs
        items={[
          { label: "Overview", href: `/politicians/${politician.slug}` },
          { label: "Funding", href: `/politicians/${politician.slug}/funding`, active: true },
          { label: "Analytics", href: `/politicians/${politician.slug}/analytics` },
        ]}
      />
      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SectionCard title="Filters">
          <div className="space-y-3 text-sm">
            {[
              "Election cycle: current placeholder",
              "Depth: 2-hop",
              "Jurisdiction: Federal",
              "Relationship: sponsorship",
              "Issue cluster: all",
              "Finance edges: pending FEC sync",
            ].map((item) => (
              <div key={item} className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Funding network">
          <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
        </SectionCard>
        <SectionCard title="Edge timeline">
          <DataTable
            columns={["Relationship", "Amount", "Type"]}
            rows={graph.edges.map((edge) => [
              `${edge.source} -> ${edge.target}`,
              edge.amount ? `$${edge.amount.toLocaleString()}` : "Context edge",
              edge.label,
            ])}
          />
        </SectionCard>
      </section>
    </div>
  );
}
