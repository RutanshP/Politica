import { notFound } from "next/navigation";

import { ChartCard } from "@/components/chart-card";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import { PartisanDonutChart, TrendLineChart } from "@/components/trend-charts";
import {
  getPoliticianAnalyticsSeries,
  getPoliticianData,
  getPoliticianRouteParams,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export async function generateStaticParams() {
  return getPoliticianRouteParams();
}

export const revalidate = 21600;

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
  const metricCards = [
    ["Missed votes", derived.missedVotes.toString()],
    ["Leadership votes", derived.leadershipVotes.toString()],
    ["Swing votes", derived.swingVotes.toString()],
    ["Consecutive votes", derived.consecutiveVotes.toString()],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Voting analytics"
        title={politician.name}
        description="Alignment, distribution, bipartisan behavior, missed votes, and swing-vote snapshots."
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <Tabs
        items={[
          { label: "Overview", href: `/politicians/${politician.slug}` },
          { label: "Funding", href: `/politicians/${politician.slug}/funding` },
          { label: "Analytics", href: `/politicians/${politician.slug}/analytics`, active: true },
        ]}
      />
      <section className="grid gap-6 xl:grid-cols-3">
        <ChartCard title="Vote alignment over time">
          <TrendLineChart data={derived.alignmentSeries} />
        </ChartCard>
        <ChartCard title="Vote distribution">
          <PartisanDonutChart data={derived.distribution} />
        </ChartCard>
        <SectionCard title="Bipartisan index">
          <div className="space-y-4">
            <div className="rounded-3xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                Index
              </p>
              <p className="mt-2 font-display text-5xl font-semibold text-emerald-600">
                +{derived.bipartisanIndex}
              </p>
              <p className="mt-2 text-sm text-[var(--muted)]">
                Derived from the live sponsored-bill footprint plus current member fields.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {metricCards.map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-[var(--line)] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                    {label}
                  </p>
                  <p className="mt-2 text-2xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
