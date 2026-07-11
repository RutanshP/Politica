import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { WatchButton } from "@/components/watch-button";
import { getCommitteesData } from "@/lib/data/committees";
import { getFundingGraphData } from "@/lib/data/graph";
import { getNewsData } from "@/lib/data/news";
import {
  getCommitteeMembershipsForPolitician,
  getPoliticianData,
  getPoliticianRouteParams,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import type { Bill, Committee, FundingEdge, NewsItem } from "@/types/civic";
import { hasVotePerformanceStats, initials } from "@/lib/utils";

export async function generateStaticParams() {
  return getPoliticianRouteParams();
}

export const revalidate = 21600;

export default async function PoliticianProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const [sponsoredBills, committeesData, graphData, newsData, committeeMemberships] = await Promise.all([
    getSponsoredBillsForPolitician(slug),
    getCommitteesData(),
    getFundingGraphData(slug),
    getNewsData(),
    getCommitteeMembershipsForPolitician(slug),
  ]);
  const relatedCommittees = committeesData.committees.filter((committee: Committee) =>
    committeeMemberships.some((membership) => membership.committeeId === committee.id),
  );
  const relatedNews = newsData.news.filter((item: NewsItem) =>
    item.relatedIds.includes(politician.id) || item.relatedIds.includes(politician.slug),
  );
  const fundingEdges = graphData.graph.edges.filter((edge: FundingEdge) => edge.target === politician.slug || edge.target === politician.id);
  const hasVoteStats = hasVotePerformanceStats(politician.stats);
  const statCards = [
    ["Votes with party", hasVoteStats ? `${politician.stats.votesWithParty}%` : "N/A"],
    ["Votes against party", hasVoteStats ? `${politician.stats.votesAgainstParty}%` : "N/A"],
    ["Attendance", hasVoteStats ? `${politician.stats.attendance}%` : "N/A"],
    ["Bills introduced", politician.stats.billsIntroduced],
    ["Bills passed", politician.stats.billsPassed],
    ["Amendments", politician.stats.amendmentsOffered],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={politician.party}
        title={politician.name}
        description={`${politician.title} from ${politician.state}${politician.district ? ` | ${politician.district}` : ""}`}
        actions={
          <>
            <SourceBadge
              label={getPoliticianSourceLabel(source)}
              live={isLivePoliticianSource(source)}
            />
            <WatchButton defaultWatched />
          </>
        }
      />
      <PoliticianTabs slug={politician.slug} active="overview" />
      <section className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <SectionCard title="About">
          <div className="flex items-center gap-4 rounded-3xl border border-[var(--line)] bg-white p-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-[linear-gradient(135deg,_#2563eb,_#1e3a8a)] font-display text-2xl font-semibold text-white">
              {initials(politician.name)}
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--ink)]">
                {politician.name}
              </p>
              <p className="text-sm text-[var(--muted)]">{politician.title}</p>
            </div>
          </div>
          <div id="biography" className="mt-5 space-y-4 text-sm text-[var(--muted)]">
            <p>{politician.biography}</p>
            <p>Born: {politician.born}</p>
            <p>Education: {politician.education}</p>
            <p>Occupation: {politician.occupation}</p>
            <p>
              Website:{" "}
              <a
                href={politician.website.startsWith("http") ? politician.website : `https://${politician.website}`}
                className="font-semibold text-[var(--accent)]"
              >
                {politician.website}
              </a>
            </p>
          </div>
        </SectionCard>
        <SectionCard
          title="Key stats"
          description="Votes, bills, attendance, and ideology snapshots."
        >
          <div className="grid gap-4 md:grid-cols-3">
            {statCards.map(([label, value]) => (
              <div
                key={label}
                className="rounded-3xl border border-[var(--line)] bg-white p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                  {label}
                </p>
                <p className="mt-2 font-display text-3xl font-semibold text-[var(--ink)]">
                  {value}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-6 space-y-4">
            {Object.entries(politician.ideology).map(([key, value]) => (
              <div key={key}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[var(--ink)]">{key}</span>
                  <span className="text-[var(--muted)]">{value}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,_#2563eb,_#22c55e)]"
                    style={{ width: `${value}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Contact">
          <div className="space-y-4 text-sm text-[var(--muted)]">
            <p>{politician.officeAddress}</p>
            <p>{politician.officePhone}</p>
            <p>Next election: {politician.nextElection}</p>
            <p>Funding relationships: {fundingEdges.length}</p>
            <Link
              href={`/politicians/${politician.slug}/analytics`}
              className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-white"
            >
              Open analytics
            </Link>
          </div>
        </SectionCard>
      </section>
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard title="Sponsored bills">
          {sponsoredBills.length < politician.stats.billsIntroduced ? (
            <p className="mb-4 text-sm text-[var(--muted)]">
              The official source reports {politician.stats.billsIntroduced} introduced bills, but the current stored bill sync window only contains {sponsoredBills.length} connected records for this member.
            </p>
          ) : null}
          <div id="bills" className="grid gap-4 lg:grid-cols-1">
            {sponsoredBills.length > 0 ? sponsoredBills.map((bill: Bill) => (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className="rounded-3xl border border-[var(--line)] bg-white p-5 transition hover:border-[var(--accent)]"
              >
                <p className="text-sm font-semibold text-[var(--accent)]">
                  {bill.number}
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">
                  {bill.title}
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">{bill.summary}</p>
              </Link>
            )) : (
              <EmptyState
                title="No stored sponsored bills in the current dataset"
                description="This profile is connected, but the currently synced bill window does not yet include sponsored legislation for this member."
                actionLabel="Open bills"
                actionHref="/bills"
              />
            )}
          </div>
        </SectionCard>
        <SectionCard title="Committees, votes, and funding overview">
          <div id="committees" className="space-y-4">
            {relatedCommittees.length > 0 ? (
              relatedCommittees.slice(0, 4).map((committee: Committee) => {
                const membership = committeeMemberships.find((item) => item.committeeId === committee.id);
                return (
                  <Link
                    key={committee.id}
                    href={`/committees/${committee.slug}`}
                    className="block rounded-2xl border border-[var(--line)] bg-white p-4 transition hover:border-[var(--accent)]"
                  >
                    <p className="font-semibold text-[var(--ink)]">{committee.name}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">{committee.jurisdiction}</p>
                    <p className="mt-1 text-sm text-[var(--muted)]">Role: {membership?.role || "Member"}</p>
                  </Link>
                );
              })
            ) : (
              <EmptyState
                title="No committee affiliations connected yet"
                description="Committee memberships are ready to display here as more detailed member data is synced."
              />
            )}
            <div className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
              Recent votes route: <Link href={`/politicians/${politician.slug}/votes`} className="font-semibold text-[var(--accent)]">open voting page</Link>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--muted)]">
              Funding overview: {fundingEdges.length > 0 ? `${fundingEdges.length} connected finance relationships` : "No finance relationships connected yet."}
            </div>
          </div>
        </SectionCard>
      </section>
      <SectionCard title="Related news">
        {relatedNews.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {relatedNews.map((item: NewsItem) => (
              <Link
                key={item.id}
                href="/news"
                className="rounded-3xl border border-[var(--line)] bg-white p-5 transition hover:border-[var(--accent)]"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                  {item.source} | {item.publishedAt}
                </p>
                <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{item.headline}</p>
                <p className="mt-2 text-sm text-[var(--muted)]">{item.summary}</p>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No connected news yet"
            description="Related headlines appear here when stored news entities reference this politician."
          />
        )}
      </SectionCard>
    </div>
  );
}
