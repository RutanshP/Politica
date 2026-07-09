import Link from "next/link";
import { notFound } from "next/navigation";

import { EntityBadge } from "@/components/entity-badge";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { StatusPill } from "@/components/status-pill";
import { Tabs } from "@/components/tabs";
import { Timeline } from "@/components/timeline";
import { WatchButton } from "@/components/watch-button";
import {
  getBillData,
  getBillRouteParams,
  getBillsData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";
import { slugifySegment } from "@/lib/utils";

export async function generateStaticParams() {
  return getBillRouteParams();
}

export const revalidate = 21600;

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const [{ bill, source }, { bills }, { politicians }, { committees }] = await Promise.all([
    getBillData(billId),
    getBillsData(),
    getPoliticiansData(),
    getCommitteesData(),
  ]);

  if (!bill) notFound();
  const live = isLiveBillsSource(source);
  const sponsor =
    politicians.find((politician) => politician.id === bill.sponsorId)
    || politicians.find((politician) => politician.slug === slugifySegment(bill.sponsorName));
  const committee =
    committees.find((item) => item.id === bill.committeeId)
    || committees.find((item) => item.slug === slugifySegment(bill.committeeName));
  const relatedBills = bills.filter((candidate) => bill.relatedBillIds.includes(candidate.id));

  const statCards = [
    ["Amendments", bill.stats.amendments],
    ["Cosponsors", bill.stats.cosponsors],
    ["Votes", bill.stats.votes],
    ["Bipartisan score", `${bill.stats.bipartisanScore}%`],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${bill.session} · ${bill.number}`}
        title={bill.title}
        description={bill.summary}
        actions={
          <>
            <SourceBadge label={getBillsSourceLabel(source)} live={live} />
            <WatchButton defaultWatched />
            <StatusPill status={bill.status} />
          </>
        }
      />

      <Tabs
        items={[
          { label: "Overview", href: `/bills/${bill.id}`, active: true },
          { label: "Timeline", href: `/bills/${bill.id}#timeline` },
          { label: "Text", href: `/bills/${bill.id}/text` },
          { label: "Votes", href: `/bills/${bill.id}/votes` },
          { label: "Sponsors", href: sponsor ? `/politicians/${sponsor.slug}` : `/bills/${bill.id}#sponsor` },
          { label: "Related", href: `/bills/${bill.id}#related` },
          { label: "News", href: "/news" },
        ]}
      />

      <section className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        <div className="space-y-6">
          <SectionCard title="Bill overview" description="Plain-English summary, sponsors, committee, and current momentum.">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4 rounded-3xl border border-[var(--line)] bg-white p-5">
                <div id="sponsor">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Sponsor
                  </p>
                  {sponsor ? (
                    <Link href={`/politicians/${sponsor.slug}`} className="mt-2 block text-sm font-semibold text-[var(--accent)]">
                      {bill.sponsorName}
                    </Link>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{bill.sponsorName}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    Committee
                  </p>
                  {committee ? (
                    <Link
                      href={`/committees/${committee.slug}`}
                      className="mt-2 block text-sm font-semibold text-[var(--accent)]"
                    >
                      {bill.committeeName}
                    </Link>
                  ) : (
                    <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{bill.committeeName}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  <EntityBadge>{bill.topic}</EntityBadge>
                  <EntityBadge tone="subtle">{bill.jurisdiction}</EntityBadge>
                </div>
              </div>
              <div className="rounded-3xl border border-[var(--line)] bg-white p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                  Chance of passing
                </p>
                <p className="mt-3 font-display text-5xl font-semibold text-[var(--ink)]">
                  {bill.chanceOfPassing}%
                </p>
                <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,_#22c55e_0%,_#2563eb_100%)]"
                    style={{ width: `${bill.chanceOfPassing}%` }}
                  />
                </div>
                <p className="mt-3 text-sm text-[var(--muted)]">
                  Derived from sponsor count, committee traction, and bipartisan activity.
                </p>
              </div>
            </div>
          </SectionCard>

          <div id="timeline">
            <SectionCard title="Timeline" description="Latest committee and floor milestones.">
              <Timeline items={bill.actions} />
            </SectionCard>
          </div>
        </div>

        <div className="space-y-6">
          <SectionCard title="Bill statistics">
            <div className="grid gap-3 sm:grid-cols-2">
              {statCards.map(([label, value]) => (
                <div key={label} className="rounded-3xl border border-[var(--line)] bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                    {label}
                  </p>
                  <p className="mt-2 font-display text-3xl font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <div id="related">
            <SectionCard title="Related bills">
              {relatedBills.length > 0 ? (
                <div className="space-y-3">
                  {relatedBills.map((related) => (
                    <Link
                      key={related.id}
                      href={`/bills/${related.id}`}
                      className="block rounded-2xl border border-[var(--line)] bg-white p-4 transition hover:border-[var(--accent)]"
                    >
                      <p className="text-sm font-semibold text-[var(--accent)]">
                        {related.number}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink)]">{related.title}</p>
                      <p className="mt-1 text-sm text-[var(--muted)]">
                        {related.summary}
                      </p>
                    </Link>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">
                  No related bills were identified from the current live feed.
                </p>
              )}
            </SectionCard>
          </div>
        </div>
      </section>
    </div>
  );
}
