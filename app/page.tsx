import {
  Activity,
  ArrowRight,
  Building2,
  Clock3,
  Landmark,
  Newspaper,
} from "lucide-react";
import Link from "next/link";

import { ChartCard } from "@/components/chart-card";
import { EntityBadge } from "@/components/entity-badge";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { SparklineCard, TrendLineChart } from "@/components/trend-charts";
import { StatusPill } from "@/components/status-pill";
import { getDashboardData } from "@/lib/data/dashboard";

export const revalidate = 21600;

export default async function HomePage() {
  const { analytics, feed } = await getDashboardData();
  const live = analytics.activeBills > 0;
  const featuredBill = feed.trendingBills[0];
  const secondaryBills = feed.trendingBills.slice(1, 4);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Civic intelligence"
        title="Good morning, Alex."
        description="Here is a connected view of the bills, votes, committees, money, and movement shaping the week."
        actions={
          <>
            <SourceBadge
              label={live ? "Stored dashboard data" : "Dashboard awaiting stored data"}
              live={live}
            />
            <Link
              href="/analytics"
              className="inline-flex items-center gap-2 rounded-full bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[var(--accent-strong)]"
            >
              Open analytics
              <ArrowRight className="h-4 w-4" />
            </Link>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SparklineCard
          title="Active bills"
          value={analytics.activeBills.toLocaleString()}
          change="Tracked from the current stored bill set"
          icon={<Landmark className="h-4 w-4" />}
          tone="emerald"
          data={analytics.activitySeries}
        />
        <SparklineCard
          title="Upcoming votes"
          value={analytics.upcomingVotes.toString()}
          change="Derived from floor and passed-chamber activity"
          icon={<Clock3 className="h-4 w-4" />}
          tone="amber"
          data={analytics.voteCadenceSeries}
        />
        <SparklineCard
          title="Tracked committees"
          value={analytics.committees.toString()}
          change="Committee records available in the current dataset"
          icon={<Building2 className="h-4 w-4" />}
          tone="sky"
          data={analytics.committeeSeries}
        />
        <SparklineCard
          title="Watchlist hits"
          value={analytics.watchlistHits.toString()}
          change="Derived from recent bill and committee activity"
          icon={<Activity className="h-4 w-4" />}
          tone="rose"
          data={analytics.alertSeries}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-6">
          <SectionCard
            title="Trending now"
            description="Fast-moving bills with strong cross-links into sponsors, committees, and issue areas."
          >
            {feed.trendingBills.length > 0 ? (
              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                {featuredBill ? (
                  <Link
                    href={`/bills/${featuredBill.id}`}
                    className="rounded-[32px] border border-[var(--line)] bg-[linear-gradient(135deg,_#0f172a,_#1e3a8a)] p-6 text-white transition hover:-translate-y-0.5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-white/70">
                          {featuredBill.number}
                        </p>
                        <h3 className="mt-3 text-2xl font-semibold leading-tight">
                          {featuredBill.title}
                        </h3>
                      </div>
                      <StatusPill status={featuredBill.status} />
                    </div>
                    <p className="mt-4 max-w-2xl text-sm leading-6 text-white/80">
                      {featuredBill.summary}
                    </p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <EntityBadge>{featuredBill.topic}</EntityBadge>
                      <EntityBadge tone="subtle">{featuredBill.sponsorName}</EntityBadge>
                      <EntityBadge tone="subtle">{featuredBill.committeeName}</EntityBadge>
                    </div>
                  </Link>
                ) : null}
                <div className="grid gap-4">
                  {secondaryBills.map((bill) => (
                    <Link
                      key={bill.id}
                      href={`/bills/${bill.id}`}
                      className="rounded-3xl border border-[var(--line)] bg-white p-4 transition hover:-translate-y-0.5 hover:border-[var(--accent)] hover:shadow-[0_20px_50px_rgba(15,23,42,0.08)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--muted)]">
                            {bill.number}
                          </p>
                          <h3 className="mt-2 text-sm font-semibold text-[var(--ink)]">
                            {bill.title}
                          </h3>
                        </div>
                        <StatusPill status={bill.status} />
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <EntityBadge>{bill.topic}</EntityBadge>
                        <EntityBadge tone="subtle">{bill.sponsorName}</EntityBadge>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Run the legislation sync to populate the dashboard.
              </p>
            )}
          </SectionCard>

          <div className="grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Bill introductions over time"
              description="A month-level pulse across the current stored dataset."
            >
              <TrendLineChart data={analytics.introductionsSeries} />
            </ChartCard>
            <SectionCard
              title="Recently passed"
              description="The most recent bills to clear a chamber or final signature step."
            >
              {feed.recentlyPassed.length > 0 ? (
                <div className="space-y-3">
                  {feed.recentlyPassed.map((bill) => (
                    <Link
                      key={bill.id}
                      href={`/bills/${bill.id}`}
                      className="flex items-center justify-between rounded-2xl border border-[var(--line)] px-4 py-3 transition hover:border-[var(--accent)]"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {bill.number}
                        </p>
                        <p className="text-sm text-[var(--muted)]">{bill.title}</p>
                      </div>
                      <div className="text-right">
                        <StatusPill status={bill.status} />
                        <p className="mt-2 text-xs text-[var(--muted)]">
                          {bill.lastActionAt}
                        </p>
                      </div>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No passed-chamber items are available in the current dataset.
                </p>
              )}
            </SectionCard>
          </div>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Upcoming votes"
            description="Floor action inferred from the latest stored bill statuses."
          >
            {feed.upcomingVotes.length > 0 ? (
              <div className="space-y-3">
                {feed.upcomingVotes.map((vote) => (
                  <Link
                    key={vote.id}
                    href={`/bills/${vote.billId}/votes`}
                    className="block rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--accent)]"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {vote.billNumber}
                        </p>
                        <p className="text-sm text-[var(--muted)]">{vote.title}</p>
                      </div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                        {vote.chamber}
                      </p>
                    </div>
                    <p className="mt-3 text-xs text-[var(--muted)]">
                      {vote.dateLabel}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No upcoming floor items are available from the current dataset.
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="News pulse"
            description="Derived headlines tied directly to tracked bills and entities."
          >
            {feed.news.length > 0 ? (
              <div className="space-y-3">
                {feed.news.map((item) => (
                  <Link
                    key={item.id}
                    href="/news"
                    className="flex gap-3 rounded-2xl border border-[var(--line)] p-4 transition hover:border-[var(--accent)]"
                  >
                    <div className="rounded-2xl bg-slate-100 p-2 text-[var(--accent)]">
                      <Newspaper className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {item.headline}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {item.source} | {item.publishedAt}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                No stored news items are available yet.
              </p>
            )}
          </SectionCard>
        </div>
      </section>
    </div>
  );
}
