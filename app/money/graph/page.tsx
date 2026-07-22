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

export default async function FundingGraphPage() {
  const { graph, source } = await getFundingGraphData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money graph"
        title="Funding network graph"
        description="Interactive network analysis across politicians, PACs, bills, committees, and issues."
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
              "Election cycle: current",
              "Jurisdiction: federal",
              "Donation amount: all",
              "Topic: all",
              "Graph depth: 1-hop / 2-hop / 3-hop",
              "Flows: PAC, sponsorship, committee review",
            ].map((item) => (
              <div key={item} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3">
                {item}
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Interactive graph">
          <NetworkGraph nodes={graph.nodes} edges={graph.edges} />
        </SectionCard>
        <SectionCard title="Relationship timeline">
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
