import { DataTable } from "@/components/data-table";
import { NetworkGraph } from "@/components/network-graph";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getFundingGraphData,
  getGraphSourceLabel,
  isLiveGraphSource,
} from "@/lib/data/graph";

export const revalidate = 21600;

export default async function FundingNetworkPage() {
  const { graph, source } = await getFundingGraphData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Funding network graph"
        description="Center-stage graph for donors, PACs, companies, lobbying firms, politicians, committees, and bills. Until direct finance feeds are configured, this can render a live Congress relationship graph from sponsored legislation."
        actions={
          <SourceBadge
            label={getGraphSourceLabel(source)}
            live={isLiveGraphSource(source)}
          />
        }
      />
      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SectionCard title="Filters">
          <div className="space-y-3 text-sm">
            {[
              "Depth filter: 1-hop / 2-hop / 3-hop",
              "Election cycle: 2024 / 2026",
              "Donation amount: $10k+",
              "Industry: Technology",
              "Party: Democratic / Republican",
              "Flow type: PAC, lobbying, IE",
            ].map((item) => (
              <div key={item} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Entity graph">
          <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
        </SectionCard>
        <SectionCard title="Edge list">
          <DataTable
            columns={["Source", "Target", "Relationship", "Amount"]}
            rows={graph.edges.map((edge) => [
              edge.source,
              edge.target,
              edge.label,
              edge.amount ? `$${edge.amount.toLocaleString()}` : "Context edge",
            ])}
          />
        </SectionCard>
      </section>
    </div>
  );
}
