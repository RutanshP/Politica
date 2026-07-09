import { ChartCard } from "@/components/chart-card";
import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { PartisanDonutChart, TrendLineChart } from "@/components/trend-charts";
import { getAnalyticsData } from "@/lib/data/analytics";
import { getPoliticiansData } from "@/lib/data/politicians";

export default async function AnalyticsPage() {
  const [{ summary }, { politicians }] = await Promise.all([
    getAnalyticsData(),
    getPoliticiansData(),
  ]);

  const statCards = [
    ["Active bills", summary.activeBills],
    ["Bills with floor votes", summary.upcomingVotes],
    ["Tracked committees", summary.committees],
    ["Watchlist hits", summary.watchlistHits],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analytics"
        title="System-wide legislative signals"
        description="Active bill counts, passage signals, partisan breakdown, time-series trends, and the most active members."
      />
      <section className="grid gap-6 xl:grid-cols-4">
        {statCards.map(([label, value]) => (
          <SectionCard key={label} title={label}>
            <p className="font-display text-4xl font-semibold text-[var(--ink)]">
              {value}
            </p>
          </SectionCard>
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <ChartCard title="Bills introduced over time">
          <TrendLineChart data={summary.introductionsSeries} />
        </ChartCard>
        <ChartCard title="Partisan breakdown of member behavior">
          <PartisanDonutChart data={summary.partisanSeries} />
        </ChartCard>
      </section>
      <SectionCard title="Most active members">
        <DataTable
          columns={["Name", "State", "Bills introduced", "Votes with party"]}
          rows={politicians.map((politician) => [
            politician.name,
            politician.state,
            politician.stats.billsIntroduced,
            `${politician.stats.votesWithParty}%`,
          ])}
        />
      </SectionCard>
    </div>
  );
}
