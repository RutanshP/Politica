import { notFound } from "next/navigation";

import { ChartCard } from "@/components/chart-card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { StatCard } from "@/components/stat-card";
import { PartisanDonutChart, VoteBarChart } from "@/components/trend-charts";
import {
  getPoliticianAnalyticsSeries,
  getPoliticianData,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export const revalidate = 21600;

const percent = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

export default async function PoliticianAnalyticsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const sponsoredBills = await getSponsoredBillsForPolitician(slug);
  const derived = getPoliticianAnalyticsSeries(politician, sponsoredBills);
  const { votes } = derived;
  const partyLine = votes.withParty + votes.againstParty;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voting analytics"
        title={politician.name}
        description="Recorded roll calls, party-line voting, and the legislation this member has sponsored."
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <PoliticianTabs slug={politician.slug} active="analytics" />

      {votes.total === 0 && sponsoredBills.length === 0 ? (
        <EmptyState
          title="No voting or sponsorship record stored"
          description="Roll-call positions and sponsored bills appear here once they are synced for this member. Governors cast no congressional votes."
        />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Roll calls on record"
              value={votes.total.toLocaleString()}
              detail="Recorded votes held while this member was seated."
            />
            <StatCard
              label="Votes cast"
              value={votes.cast.toLocaleString()}
              detail={`${percent(votes.cast, votes.total)} attendance.`}
            />
            <StatCard
              label="Missed"
              value={votes.missed.toLocaleString()}
              detail="Roll calls with no recorded vote from this member."
            />
            <StatCard
              label="Voted with party"
              value={percent(votes.withParty, partyLine)}
              detail={`${votes.withParty.toLocaleString()} of ${partyLine.toLocaleString()} votes where the party majority took a side.`}
            />
          </section>

          <section className="grid gap-6 xl:grid-cols-3">
            <ChartCard title="Party-line votes">
              {derived.distribution.length > 0 ? (
                <PartisanDonutChart data={derived.distribution} />
              ) : (
                <p className="text-sm text-[var(--muted)]">No party-line votes recorded.</p>
              )}
            </ChartCard>
            <ChartCard title="Sponsored bills by topic">
              {derived.topicSeries.length > 0 ? (
                <VoteBarChart data={derived.topicSeries} />
              ) : (
                <p className="text-sm text-[var(--muted)]">No sponsored bills stored.</p>
              )}
            </ChartCard>
            <ChartCard title="How far their bills got">
              {derived.statusSeries.length > 0 ? (
                <VoteBarChart data={derived.statusSeries} />
              ) : (
                <p className="text-sm text-[var(--muted)]">No sponsored bills stored.</p>
              )}
            </ChartCard>
          </section>
        </>
      )}
    </div>
  );
}
