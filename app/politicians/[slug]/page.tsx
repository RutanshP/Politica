import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import { WatchButton } from "@/components/watch-button";
import {
  getPoliticianData,
  getPoliticianRouteParams,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import { initials } from "@/lib/utils";

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

  const sponsoredBills = await getSponsoredBillsForPolitician(slug);
  const statCards = [
    ["Votes with party", `${politician.stats.votesWithParty}%`],
    ["Votes against party", `${politician.stats.votesAgainstParty}%`],
    ["Attendance", `${politician.stats.attendance}%`],
    ["Bills introduced", politician.stats.billsIntroduced],
    ["Bills passed", politician.stats.billsPassed],
    ["Amendments", politician.stats.amendmentsOffered],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={politician.party}
        title={politician.name}
        description={`${politician.title} from ${politician.state}${politician.district ? ` · ${politician.district}` : ""}`}
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
      <Tabs
        items={[
          { label: "Overview", href: `/politicians/${politician.slug}`, active: true },
          { label: "Votes", href: `/politicians/${politician.slug}` },
          { label: "Bills", href: `/politicians/${politician.slug}` },
          { label: "Committees", href: `/politicians/${politician.slug}` },
          { label: "Funding", href: `/politicians/${politician.slug}/funding` },
          { label: "Analytics", href: `/politicians/${politician.slug}/analytics` },
          { label: "Biography", href: `/politicians/${politician.slug}` },
          { label: "News", href: "/news" },
        ]}
      />
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
          <div className="mt-5 space-y-4 text-sm text-[var(--muted)]">
            <p>{politician.biography}</p>
            <p>Born: {politician.born}</p>
            <p>Education: {politician.education}</p>
            <p>Occupation: {politician.occupation}</p>
            <p>
              Website:{" "}
              <a
                href={`https://${politician.website}`}
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
            <Link
              href={`/politicians/${politician.slug}/analytics`}
              className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-white"
            >
              Open analytics
            </Link>
          </div>
        </SectionCard>
      </section>
      <SectionCard title="Sponsored bills">
        <div className="grid gap-4 lg:grid-cols-2">
          {sponsoredBills.map((bill) => (
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
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
