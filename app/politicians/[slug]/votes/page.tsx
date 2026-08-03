import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
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
import { hasVotePerformanceStats, voteHref } from "@/lib/utils";
import { isSubstantiveVote } from "@/lib/vote-classification";
import { groupVotesByBill, summarizePositions } from "@/lib/vote-grouping";

export const revalidate = 21600;

/** The member's own position on the roll call, colored green Yea / red Nay. */
function positionStyle(vote: string | undefined) {
  if (vote === "Yea") return { label: "Voted Yea", ink: "var(--success)", soft: "var(--success-soft)" };
  if (vote === "Nay") return { label: "Voted Nay", ink: "var(--danger)", soft: "var(--danger-soft)" };
  if (vote === "Present") return { label: "Present", ink: "var(--warning)", soft: "var(--warning-soft)" };
  if (vote === "Not Voting") return { label: "Did not vote", ink: "var(--muted)", soft: "var(--line)" };
  return { label: "Vote unavailable", ink: "var(--muted)", soft: "var(--line)" };
}

/** Whether the measure itself passed, so the outcome reads at a glance. */
function resultStyle(result: string) {
  if (/passed|agreed|confirm/i.test(result)) return { label: result, ink: "var(--success)", soft: "var(--success-soft)" };
  if (/fail|reject|defeat/i.test(result)) return { label: result, ink: "var(--danger)", soft: "var(--danger-soft)" };
  return { label: result, ink: "var(--muted)", soft: "var(--line)" };
}

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
  // Grouped by measure: one bill can draw six recorded votes, which used to be six near-identical
  // cards that crowded every other measure off the list.
  const voteGroups = groupVotesByBill(substantiveVotes).slice(0, 8);
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
          {voteGroups.length > 0 ? (
            <div className="space-y-3">
              {voteGroups.map((group) => {
                const multiple = group.votes.length > 1;
                return (
                  <div
                    key={group.key}
                    className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-semibold text-[var(--accent-2)]">{group.billNumber}</p>
                      <p className="num shrink-0 text-xs text-[var(--muted)]">
                        {multiple ? `${group.votes.length} votes · ` : null}
                        {summarizePositions(group.counts)}
                      </p>
                    </div>
                    {group.billTitle ? (
                      <p className="mt-1 text-sm text-[var(--ink)]">{group.billTitle}</p>
                    ) : null}

                    {/*
                      Each roll call keeps its own row -- the motion, the outcome, the date and how
                      they voted -- so grouping loses none of the detail the flat list carried. The
                      rows are the links; the card is a plain container, since a link cannot nest.
                    */}
                    <div className="mt-2.5 flex flex-col divide-y divide-[var(--line)] border-t border-[var(--line)]">
                      {group.votes.map((vote) => {
                        const position = positionStyle(vote.positions[0]?.vote);
                        const outcome = resultStyle(vote.result);
                        return (
                          <Link
                            key={vote.id}
                            href={vote.billId ? voteHref(vote.billId, vote.id) : `/politicians/${politician.slug}/votes`}
                            className="group/row flex flex-wrap items-center gap-x-2.5 gap-y-1 py-2 transition hover:bg-[var(--panel)]"
                          >
                            <span
                              className="h-1.5 w-1.5 shrink-0 rounded-full"
                              style={{ background: position.ink }}
                              aria-hidden
                            />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ink)] group-hover/row:text-[var(--accent-2)]">
                              {vote.title}
                            </span>
                            <span
                              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ background: outcome.soft, color: outcome.ink }}
                            >
                              {outcome.label}
                            </span>
                            <span
                              className="inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold"
                              style={{ background: position.soft, color: position.ink }}
                            >
                              {position.label}
                            </span>
                            <span className="num shrink-0 text-[11px] text-[var(--muted)]">{vote.dateLabel}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
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
