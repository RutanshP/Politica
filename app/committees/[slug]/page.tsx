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
import { listStoredBillsByIds } from "@/lib/supabase/bills";
import { listStoredPoliticiansByIds } from "@/lib/supabase/politicians";
import { deriveCommitteeSector, normalizeCommitteeField } from "@/lib/utils";
import type { Bill } from "@/types/civic";

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

  // One id=in.(...) read for the active bills instead of a getBillData() call per bill -- each
  // of which was its own bill + actions + versions + 2 sync-run round trips.
  const [members, activeBills] = await Promise.all([
    // Only this committee's roster. Loading every politician to filter it down was the single
    // largest egress cost in the app -- ~3MB per committee page, 380+ of them per build.
    listStoredPoliticiansByIds(committee.memberIds),
    listStoredBillsByIds(committee.activeBillIds).catch(() => [] as Bill[]),
  ]);
  const sector = deriveCommitteeSector(committee);

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
              <p>Sector: {sector}</p>
              <p>Jurisdiction: {committee.jurisdiction}</p>
              <p>Chair: {normalizeCommitteeField(committee.chair, "Leadership has not been synced yet")}</p>
              <p>Ranking member: {normalizeCommitteeField(committee.rankingMember, "Ranking member has not been synced yet")}</p>
              <p>Upcoming hearing: {normalizeCommitteeField(committee.hearing, "No hearing scheduled")}</p>
              <p>Contact URL: {committee.contactUrl ? <a href={committee.contactUrl} className="font-semibold text-[var(--accent-2)]">{committee.contactUrl}</a> : "Not available yet"}</p>
              <p>Phone: {committee.contactPhone || "Not available yet"}</p>
              <p>Address: {committee.contactAddress || "Not available yet"}</p>
              <p>Subcommittees: {committee.subcommittees?.length ? committee.subcommittees.map((item) => item.name).join(", ") : "None stored yet"}</p>
            </div>
          </SectionCard>
          <SectionCard title="Members">
            <div className="grid gap-4 md:grid-cols-2">
              {members.length > 0 ? members.map((member) => (
                <Link
                  key={member.id}
                  href={`/politicians/${member.slug}`}
                  className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-5 transition hover:border-[var(--line-2)]"
                >
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {member.name}
                  </p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {member.party} · {member.state}
                  </p>
                </Link>
              )) : (
                <p className="text-sm text-[var(--muted)]">
                  Member roster has not been synced for this committee yet.
                </p>
              )}
            </div>
          </SectionCard>
        </div>
        <SectionCard title="Active bills">
          <div className="space-y-3">
            {activeBills.length > 0 ? activeBills.map((bill) => (
              <Link
                key={bill.id}
                href={`/bills/${bill.id}`}
                className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4 transition hover:border-[var(--line-2)]"
              >
                <p className="text-sm font-semibold text-[var(--accent-2)]">
                  {bill.number}
                </p>
                <p className="mt-1 text-sm text-[var(--ink)]">{bill.title}</p>
              </Link>
            )) : (
              <p className="text-sm text-[var(--muted)]">
                No active stored bills are linked to this committee yet.
              </p>
            )}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
