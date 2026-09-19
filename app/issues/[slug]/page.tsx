import Link from "next/link";
import { notFound } from "next/navigation";

import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { LobbiedBillsCard } from "@/components/lobbying/lobbied-bills-card";
import {
  getIssueRouteParams,
  getIssueSourceLabel,
  getIssueViewData,
  isLiveIssueSource,
} from "@/lib/data/issues";
import { getMostLobbiedBills } from "@/lib/data/lobbying";
import { billHref } from "@/lib/utils";

export async function generateStaticParams() {
  return getIssueRouteParams();
}

export const revalidate = 21600;

export default async function IssuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { issue, source, issueBills, issueCommittees, topPoliticians } = await getIssueViewData(slug);
  if (!issue) notFound();
  const lobbiedBills = await getMostLobbiedBills({ issueId: issue.id, limit: 8 });

  const statCards = [
    ["Active bills", issue.stats.activeBills],
    ["Recent votes", issue.stats.recentVotes],
    ["Became law", issue.stats.enacted],
    ["Related committees", issue.committeeIds.length],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Issues"
        title={issue.name}
        description={issue.description}
        actions={
          <SourceBadge
            label={getIssueSourceLabel(source)}
            live={isLiveIssueSource(source)}
          />
        }
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
      <section className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <SectionCard title="Top active bills">
          <div className="space-y-3">
            {issueBills.map((bill) => (
              <Link
                key={bill.id}
                href={billHref(bill.id)}
                className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4 transition hover:border-[var(--line-2)]"
              >
                <p className="font-semibold text-[var(--accent-2)]">{bill.number}</p>
                <p className="mt-1 text-sm text-[var(--ink)]">{bill.title}</p>
              </Link>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Top politicians by activity">
          <DataTable
            columns={["Politician", "Role", "State"]}
            rows={topPoliticians.map((politician) => [
              <Link key={politician.id} href={`/politicians/${politician.slug}`} className="font-semibold text-[var(--accent-2)]">
                {politician.name}
              </Link>,
              politician.title,
              politician.state,
            ])}
          />
        </SectionCard>
      </section>
      <LobbiedBillsCard
        title={`Most-lobbied ${issue.name.toLowerCase()} bills`}
        rows={lobbiedBills}
        note="Ranked by how many organizations named the bill in their Lobbying Disclosure Act reports this Congress."
      />
      <SectionCard title="Related committees">
        <div className="grid gap-4 md:grid-cols-2">
          {issueCommittees.map((committee) => (
            <Link
              key={committee.slug}
              href={`/committees/${committee.slug}`}
              className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-5 transition hover:border-[var(--line-2)]"
            >
              <p className="font-semibold text-[var(--ink)]">{committee.name}</p>
              <p className="mt-2 text-sm text-[var(--muted)]">{committee.jurisdiction}</p>
            </Link>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
