import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import {
  getCommitteeData,
  getCommitteeRouteParams,
  getCommitteeSourceLabel,
  isLiveCommitteeSource,
} from "@/lib/data/committees";
import { getBillData } from "@/lib/data/bills";
import { getPoliticiansData } from "@/lib/data/politicians";

export async function generateStaticParams() {
  return getCommitteeRouteParams();
}

export const revalidate = 21600;

export default async function CommitteePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { committee, source } = await getCommitteeData(slug);
  if (!committee) notFound();

  const { politicians } = await getPoliticiansData();
  const members = politicians.filter((politician) => committee.memberIds.includes(politician.id));
  const activeBills = (
    await Promise.all(committee.activeBillIds.map((billId) => getBillData(billId)))
  )
    .map((result) => result.bill)
    .filter((bill): bill is NonNullable<typeof bill> => Boolean(bill));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={committee.chamber}
        title={committee.name}
        description={committee.description}
        actions={
          <SourceBadge
            label={getCommitteeSourceLabel(source)}
            live={isLiveCommitteeSource(source)}
          />
        }
      />
      <Tabs
        items={[
          { label: "Overview", href: `/committees/${committee.slug}`, active: true },
          { label: "Members", href: `/committees/${committee.slug}` },
          { label: "Bills", href: `/committees/${committee.slug}` },
          { label: "Hearings", href: `/committees/${committee.slug}` },
          { label: "Votes", href: `/committees/${committee.slug}` },
          { label: "News", href: "/news" },
        ]}
      />
      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <SectionCard title="Committee overview">
            <div className="space-y-4 text-sm text-[var(--muted)]">
              <p>Jurisdiction: {committee.jurisdiction}</p>
              <p>Chair: {committee.chair}</p>
              <p>Ranking member: {committee.rankingMember}</p>
              <p>Upcoming hearing: {committee.hearing}</p>
            </div>
          </SectionCard>
          <SectionCard title="Members">
            <div className="grid gap-4 md:grid-cols-2">
              {members.map((member) => (
                <Link
                  key={member.id}
                  href={`/politicians/${member.slug}`}
                  className="rounded-3xl border border-[var(--line)] bg-white p-5 transition hover:border-[var(--accent)]"
                >
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {member.name}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {member.party} · {member.state}
                  </p>
                </Link>
              ))}
            </div>
          </SectionCard>
        </div>
        <SectionCard title="Active bills">
          <div className="space-y-3">
            {activeBills.map((bill) => (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className="block rounded-2xl border border-[var(--line)] bg-white p-4 transition hover:border-[var(--accent)]"
              >
                <p className="text-sm font-semibold text-[var(--accent)]">
                  {bill.number}
                </p>
                <p className="mt-1 text-sm text-[var(--ink)]">{bill.title}</p>
              </Link>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
