import { notFound } from "next/navigation";

import { ChartCard } from "@/components/chart-card";
import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { BillTabs } from "@/components/bill-tabs";
import { VoteBarChart } from "@/components/trend-charts";
import { VoteTypeBadge } from "@/components/vote-type-badge";
import { VOTE_CATEGORY_META, isSubstantiveVote } from "@/lib/vote-classification";
import {
  getBillData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import {
  getVoteSourceLabel,
  getVotesDataForBill,
  isLiveVoteSource,
} from "@/lib/data/votes";

export const revalidate = 21600;

export default async function BillVotesPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ voteId?: string }>;
}) {
  const { billId } = await params;
  const { voteId } = await searchParams;
  const { bill, source } = await getBillData(billId);
  if (!bill) notFound();

  const { votes, source: voteSource } = await getVotesDataForBill(billId);
  // Default to a substantive vote (passage/amendment) rather than whatever procedural motion
  // happens to be first, so the page opens on the policy decision that matters.
  const vote =
    votes.find((item) => item.id === voteId)
    || votes.find((item) => isSubstantiveVote(item.category ?? "policy"))
    || votes[0];
  const live = isLiveBillsSource(source);
  const voteStats = vote
    ? ([
        ["Yea", vote.yea],
        ["Nay", vote.nay],
        ["Present", vote.present],
        ["Not Voting", vote.notVoting],
      ] as const)
    : [];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bill votes"
        title={`${bill.number} - ${bill.title}`}
        description="Vote result summary, grouped outcome visualization, detail stats, and a filter-ready member vote table."
        actions={
          <>
            <SourceBadge label={getBillsSourceLabel(source)} live={live} />
            <SourceBadge
              label={getVoteSourceLabel(voteSource)}
              live={isLiveVoteSource(voteSource)}
            />
          </>
        }
      />
      <BillTabs billId={bill.id} active="votes" />
      {vote ? (
        <>
          <section className="grid gap-6 xl:grid-cols-[1.3fr_0.9fr]">
            <ChartCard title="Vote result summary" description={`${vote.chamber} vote · ${vote.dateLabel}`}>
              <VoteBarChart
                data={[
                  { label: "Yea", value: vote.yea },
                  { label: "Nay", value: vote.nay },
                  { label: "Present", value: vote.present },
                  { label: "Not voting", value: vote.notVoting },
                ]}
              />
            </ChartCard>
            <SectionCard title="Vote details">
              <div className="space-y-4">
                {votes.length > 1 ? (
                  <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Vote records
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {votes.map((item) => (
                        <a
                          key={item.id}
                          href={`/bills/${bill.id}/votes?voteId=${encodeURIComponent(item.id)}`}
                          className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${
                            item.id === vote.id
                              ? "bg-[var(--accent)] text-white"
                              : "border border-[var(--line)] bg-[var(--panel-2)] text-[var(--ink)]"
                          }`}
                        >
                          {item.dateLabel}
                          {!isSubstantiveVote(item.category ?? "policy") ? (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${item.id === vote.id ? "bg-white/25" : "bg-white/6 text-[var(--muted)]"}`}>
                              {VOTE_CATEGORY_META[item.category ?? "policy"].label}
                            </span>
                          ) : null}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
                      Result
                    </p>
                    <VoteTypeBadge category={vote.category} />
                  </div>
                  <p className="mt-2 font-display text-4xl font-semibold">
                    {vote.result}
                  </p>
                  <p className="mt-2 text-sm text-[var(--muted)]">{vote.title}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {voteStats.map(([label, value]) => (
                    <div key={label} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--muted)]">
                        {label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </SectionCard>
          </section>
          <SectionCard
            title="Member vote table"
            description="Stored member-by-member vote positions for the selected bill."
          >
            <div className="mb-5">
              <FilterBar
                filters={[
                  { label: "Party", value: "All parties", options: ["All parties", "Democratic", "Republican", "Independent"] },
                  { label: "State", value: "All states", options: ["All states"] },
                  { label: "Vote", value: "All vote positions", options: ["All vote positions", "Yea", "Nay", "Present", "Not Voting"] },
                  { label: "Chamber", value: vote.chamber, options: [vote.chamber] },
                ]}
              />
            </div>
            <DataTable
              columns={["Member", "Party", "State", "Vote"]}
              rows={vote.positions.map((position) => [
                position.name,
                position.party,
                position.state,
                <span
                  key={`${position.name}-${position.vote}`}
                  className={`font-semibold ${
                    position.vote === "Yea"
                      ? "text-emerald-700"
                      : position.vote === "Nay"
                        ? "text-rose-700"
                        : "text-amber-700"
                  }`}
                >
                  {position.vote}
                </span>,
              ])}
            />
          </SectionCard>
        </>
      ) : (
        <SectionCard title="No vote data yet">
          <p className="text-sm text-[var(--muted)]">
            This bill is stored, but no vote records have been synced for it yet.
          </p>
        </SectionCard>
      )}
    </div>
  );
}
