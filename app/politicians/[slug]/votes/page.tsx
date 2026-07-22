import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getPoliticianData,
  getPoliticianSourceLabel,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import {
  getVoteSourceLabel,
  getVotesDataForPolitician,
  isLiveVoteSource,
} from "@/lib/data/votes";
import { hasVotePerformanceStats } from "@/lib/utils";
import { VoteTypeBadge } from "@/components/vote-type-badge";
import { isSubstantiveVote } from "@/lib/vote-classification";

export const revalidate = 21600;

export default async function PoliticianVotesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();
  const { votes, source: voteSource } = await getVotesDataForPolitician(politician.id);
  const substantiveVotes = votes.filter((vote) => isSubstantiveVote(vote.category ?? "policy"));
  const proceduralCount = votes.length - substantiveVotes.length;
  const issueOptions = [...new Set(substantiveVotes.map((vote) => vote.title).slice(0, 6))];
  const hasVoteStats = hasVotePerformanceStats(politician.stats);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Votes"
        title={politician.name}
        description="Recent voting context, attendance, party alignment, and vote-related legislative activity."
        actions={
          <>
            <SourceBadge label={getPoliticianSourceLabel(source)} live={isLivePoliticianSource(source)} />
            <SourceBadge label={getVoteSourceLabel(voteSource)} live={isLiveVoteSource(voteSource)} />
          </>
        }
      />
      <PoliticianTabs slug={politician.slug} active="votes" />
      <SectionCard title="Vote filters">
        <FilterBar
          filters={[
            { label: "Party", value: politician.party, options: [politician.party] },
            { label: "State", value: politician.state, options: [politician.state] },
            { label: "Chamber", value: politician.title.includes("Senator") ? "Senate" : "House", options: [politician.title.includes("Senator") ? "Senate" : "House"] },
            { label: "Issue", value: "All issues", options: ["All issues", ...issueOptions] },
          ]}
        />
      </SectionCard>
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Voting profile">
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">With party</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--ink)]">{hasVoteStats ? `${politician.stats.votesWithParty}%` : "N/A"}</p>
            </div>
            <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Against party</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--ink)]">{hasVoteStats ? `${politician.stats.votesAgainstParty}%` : "N/A"}</p>
            </div>
            <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">Attendance</p>
              <p className="mt-2 text-3xl font-semibold text-[var(--ink)]">{hasVoteStats ? `${politician.stats.attendance}%` : "N/A"}</p>
            </div>
          </div>
        </SectionCard>
        <SectionCard
          title="Recent policy votes"
          description={proceduralCount > 0
            ? `Substantive passage and amendment votes. ${proceduralCount} procedural motion${proceduralCount === 1 ? "" : "s"} (cloture, motions to proceed, etc.) set aside.`
            : "Substantive passage and amendment votes."}
        >
          {substantiveVotes.length > 0 ? (
            <div className="space-y-3">
              {substantiveVotes.slice(0, 8).map((vote) => (
                <Link
                  key={vote.id}
                  href={vote.billId ? `/bills/${vote.billId}/votes` : `/politicians/${politician.slug}/votes`}
                  className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4 transition hover:border-[var(--line-2)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-[var(--accent-2)]">{vote.billNumber}</p>
                    <VoteTypeBadge category={vote.category} />
                  </div>
                  <p className="mt-1 text-sm text-[var(--ink)]">{vote.title}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {vote.positions[0]?.vote || "Vote unavailable"} | {vote.result} | {vote.dateLabel}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <EmptyState
              title={votes.length > 0 ? "Only procedural votes on record" : "No stored vote records available"}
              description={votes.length > 0
                ? `This member has ${votes.length} stored vote${votes.length === 1 ? "" : "s"}, but they are all procedural motions rather than substantive policy votes.`
                : "This member does not yet have synced vote-position records in the current stored dataset."}
            />
          )}
        </SectionCard>
      </section>
    </div>
  );
}
