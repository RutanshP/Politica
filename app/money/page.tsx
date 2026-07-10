import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { StatCard } from "@/components/stat-card";
import {
  getFundingGraphData,
  getGraphSourceLabel,
  isLiveGraphSource,
} from "@/lib/data/graph";

export const revalidate = 21600;

export default async function MoneyDashboardPage() {
  const { graph, source } = await getFundingGraphData();
  const topPacs = graph.nodes.filter((node) => node.type === "pac");
  const topCompanies = graph.nodes.filter((node) => node.type === "company");
  const topIndustries = graph.nodes.filter((node) => node.type === "industry");
  const topLobbyingFirms = graph.nodes.filter((node) => node.type === "lobbying-firm");
  const totalAmount = graph.edges.reduce((sum, edge) => sum + edge.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Money"
        title="Funding dashboard"
        description="Track donation totals, PAC activity, connected industries, committees, and funding relationships before diving into the full graph."
        actions={
          <SourceBadge
            label={getGraphSourceLabel(source)}
            live={isLiveGraphSource(source)}
          />
        }
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Top PACs" value={topPacs.length} detail="Campaign committees connected to politicians in the current graph." />
        <StatCard label="Companies" value={topCompanies.length} detail="Corporate entities available from connected finance feeds." />
        <StatCard label="Industries" value={topIndustries.length} detail="Industry clusters linked to current graph nodes." />
        <StatCard label="Tracked dollars" value={`$${totalAmount.toLocaleString()}`} detail="Aggregated edge amounts across the funding graph." />
      </section>
      <section className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="Top PACs">
          {topPacs.length > 0 ? (
            <DataTable
              columns={["PAC", "Detail", "Amount"]}
              rows={topPacs.map((node) => [node.label, node.detail, node.amount || "—"])}
            />
          ) : (
            <EmptyState
              title="No PACs available yet"
              description="Add your FEC API key or expand the finance sync to populate campaign finance entities here."
            />
          )}
        </SectionCard>
        <SectionCard title="Companies and lobbying">
          {topCompanies.length > 0 || topLobbyingFirms.length > 0 ? (
            <DataTable
              columns={["Entity", "Type", "Detail"]}
              rows={[...topCompanies, ...topLobbyingFirms].map((node) => [
                node.label,
                node.type,
                node.detail,
              ])}
            />
          ) : (
            <EmptyState
              title="Company and lobbying data not connected"
              description="The graph architecture supports these entity types, but the current live feeds do not provide them yet."
            />
          )}
        </SectionCard>
      </section>
      <SectionCard title="Open graph">
        <div className="flex items-center justify-between rounded-3xl border border-[var(--line)] bg-white px-5 py-4">
          <p className="text-sm text-[var(--muted)]">
            Use the graph explorer for interactive network analysis across politicians, PACs, bills, issues, and committees.
          </p>
          <a href="/money/graph" className="rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">
            Open graph
          </a>
        </div>
      </SectionCard>
    </div>
  );
}
