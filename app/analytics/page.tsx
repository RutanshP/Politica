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
    ["Bills this Congress", summary.activeBills],
    ["On the floor or past a chamber", summary.upcomingVotes],
    ["Became law", summary.enacted],
    ["Committees", summary.committees],
  ] as const;

  // Ranked by sponsorship, sitting federal members only. The table used to list every stored
  // politician in alphabetical order under a "Most active" heading.
  const mostActive = politicians
    .filter((politician) => politician.jurisdictionType !== "state" && politician.stats.billsIntroduced > 0)
    .sort((left, right) => right.stats.billsIntroduced - left.stats.billsIntroduced)
    .slice(0, 15);

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
              {value.toLocaleString()}
            </p>
          </SectionCard>
        ))}
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
        <ChartCard title="Bills introduced per month">
          <TrendLineChart data={summary.introductionsSeries} />
        </ChartCard>
        <ChartCard title="Party-line voting, average member (%)">
          <PartisanDonutChart data={summary.partisanSeries} />
        </ChartCard>
      </section>
      <SectionCard title="Most active members">
        <DataTable
          columns={["Name", "State", "Bills introduced", "Votes with party"]}
          rows={mostActive.map((politician) => [
            politician.name,
            politician.state,
            politician.stats.billsIntroduced,
            politician.stats.votesWithParty + politician.stats.votesAgainstParty > 0
              ? `${politician.stats.votesWithParty}%`
              : "No votes",
          ])}
        />
      </SectionCard>
    </div>
  );
}
