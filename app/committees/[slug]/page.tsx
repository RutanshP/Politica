import { notFound } from "next/navigation";
import { FileText, Layers, Tag as TagIcon, Users } from "lucide-react";

import { Avatar } from "@/components/ui/avatar";
import { Tag } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { CommitteeSeal } from "@/components/committee-seal";
import { CommitteeTabsView, type CommitteeMember } from "@/components/committee-tabs-view";
import { SourceBadge } from "@/components/source-badge";
import {
  deriveCommitteeLeadership,
  getCommitteeData,
  getCommitteeRouteParams,
  getCommitteeSourceLabel,
  isLiveCommitteeSource,
} from "@/lib/data/committees";
import {
  countStoredBillsByCommitteeId,
  listStoredBillsByCommitteeId,
  topicBreakdownByCommitteeId,
} from "@/lib/supabase/bills";
import { listStoredPoliticiansByIds } from "@/lib/supabase/politicians";
import { deriveCommitteeSector, partyAbbrev } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export async function generateStaticParams() {
  return getCommitteeRouteParams();
}

export const revalidate = 21600;

function chamberLabel(chamber: string) {
  if (chamber === "House") return "U.S. House of Representatives";
  if (chamber === "Senate") return "United States Senate";
  if (chamber === "Joint") return "Joint Committee of Congress";
  return chamber;
}

export default async function CommitteePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { committee, source, memberships } = await getCommitteeData(slug);
  if (!committee) notFound();

  const [roster, bills, billsCount, topics] = await Promise.all([
    // Only this committee's roster. Loading every politician to filter it down was the single
    // largest egress cost in the app -- ~3MB per committee page, 380+ of them per build.
    listStoredPoliticiansByIds(committee.memberIds),
    // Bills referred to this committee, read live from bills.committee_id (every bill carries it)
    // rather than the sparsely-populated committees.active_bill_ids array.
    listStoredBillsByCommitteeId(committee.id, 30).catch(() => [] as Bill[]),
    countStoredBillsByCommitteeId(committee.id).catch(() => 0),
    topicBreakdownByCommitteeId(committee.id).catch(() => [] as Array<{ topic: string; count: number }>),
  ]);

  const sector = deriveCommitteeSector(committee);
  const nameById = new Map(roster.map((member) => [member.id, member.name]));

  // Pair each membership role with the member record, preserving the synced roster order.
  const roleRank = (role: string) =>
    /chair/i.test(role) && !/vice|co-?chair/i.test(role) ? 0 : /ranking/i.test(role) ? 1 : 2;
  const members: CommitteeMember[] = memberships
    .map((membership) => {
      const person = roster.find((member) => member.id === membership.politicianId);
      if (!person) return undefined;
      return {
        id: person.id,
        slug: person.slug,
        name: person.name,
        party: person.party,
        state: person.state,
        role: membership.role,
      };
    })
    .filter((member): member is CommitteeMember => Boolean(member))
    .sort((left, right) => roleRank(left.role) - roleRank(right.role) || left.name.localeCompare(right.name));

  const leadership = deriveCommitteeLeadership(memberships, nameById);
  const committeeWithLeadership = {
    ...committee,
    chair: leadership.chair ?? committee.chair,
    rankingMember: leadership.rankingMember ?? committee.rankingMember,
  };
  const chair = members.find((member) => roleRank(member.role) === 0);
  const ranking = members.find((member) => roleRank(member.role) === 1);

  const democrats = members.filter((member) => /^d/i.test(member.party)).length;
  const republicans = members.filter((member) => /^r/i.test(member.party)).length;
  const partyFootnote = members.length
    ? [democrats ? `${democrats} D` : "", republicans ? `${republicans} R` : ""].filter(Boolean).join(" · ")
    : undefined;

  return (
    <div className="space-y-6">
      <section className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex min-w-0 gap-5">
          <CommitteeSeal chamber={committee.chamber} sector={sector} />
          <div className="min-w-0 space-y-3">
            <h1 className="text-2xl font-semibold tracking-[-0.01em] text-[var(--ink)]">{committee.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{chamberLabel(committee.chamber)}</Tag>
              <Tag>{sector}</Tag>
              <SourceBadge label={getCommitteeSourceLabel(source)} live={isLiveCommitteeSource(source)} />
            </div>
            <p className="max-w-2xl text-sm leading-relaxed text-[var(--muted)]">{committee.description}</p>
          </div>
        </div>

        {(chair || ranking) ? (
          <div className="flex flex-none gap-4 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-4">
            {chair ? <LeaderCell label="Chair" member={chair} /> : null}
            {chair && ranking ? <span className="w-px self-stretch bg-[var(--line)]" /> : null}
            {ranking ? <LeaderCell label="Ranking Member" member={ranking} /> : null}
          </div>
        ) : null}
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Referred bills" value={billsCount.toLocaleString()} icon={<FileText />} tone="indigo" />
        <StatTile label="Members" value={members.length} icon={<Users />} tone="sky" footnote={partyFootnote} />
        <StatTile label="Subcommittees" value={committee.subcommittees?.length ?? 0} icon={<Layers />} tone="amber" />
        <StatTile label="Issue areas" value={topics.length} icon={<TagIcon />} tone="emerald" footnote="Across referred bills" />
      </div>

      <CommitteeTabsView
        committee={committeeWithLeadership}
        members={members}
        bills={bills}
        billsCount={billsCount}
        topics={topics}
      />
    </div>
  );
}

function LeaderCell({ label, member }: { label: string; member: CommitteeMember }) {
  return (
    <div className="min-w-[150px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">{label}</p>
      <div className="mt-2 flex items-center gap-2.5">
        <Avatar name={member.name} id={member.id} party={member.party} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--ink)]">{member.name}</p>
          <p className="truncate text-xs text-[var(--muted)]">
            {partyAbbrev(member.party)} · {member.state}
          </p>
        </div>
      </div>
    </div>
  );
}
