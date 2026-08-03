import Link from "next/link";
import { notFound } from "next/navigation";
import { Info } from "lucide-react";

import { BillTabs } from "@/components/bill-tabs";
import { BillTextViewer } from "@/components/bill-text-viewer";
import { BillVersionSelect } from "@/components/bill-version-select";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { fetchBillTextDocument, resolveBillTextSource } from "@/lib/adapters/bill-text";
import {
  baseTextForVersion,
  buildBillVersionEntries,
  resolveBillVersion,
  splitAmendmentText,
} from "@/lib/bill-versions";
import { getBillData, getBillsSourceLabel, isLiveBillsSource } from "@/lib/data/bills";
import { getVotesDataForBill } from "@/lib/data/votes";
import { cn, voteHref } from "@/lib/utils";

export const revalidate = 21600;

/**
 * Text and Votes as one tab, because they are the two things a version governs.
 *
 * They used to be separate top-level tabs with no shared state, so nothing on the page said that
 * picking a version changed both -- or that Overview and Timeline were unaffected. Folding them
 * under one selector makes the dependency structural: the control sits above the panel it governs,
 * and the tabs that ignore it do not render it at all.
 */
export default async function BillVersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ v?: string; view?: string; vote?: string }>;
}) {
  const { billId: rawBillId } = await params;
  const billId = decodeURIComponent(rawBillId);
  const { v: requestedVersion, view: requestedView, vote: requestedVote } = await searchParams;

  const { bill, source } = await getBillData(billId);
  if (!bill) notFound();

  const { votes } = await getVotesDataForBill(billId);
  const entries = buildBillVersionEntries(bill, votes);
  const selected = resolveBillVersion(entries, { versionId: requestedVersion, voteId: requestedVote });
  const view = requestedView === "votes" ? "votes" : "text";

  // An amendment is read against the bill text operative when it was offered.
  const baseText = baseTextForVersion(entries, selected);
  const baseVersion = baseText
    ? bill.versions.find((version) => `text-${version.id}` === baseText.id)
    : undefined;
  const textSource = baseVersion ? resolveBillTextSource([baseVersion], baseVersion.id) : null;
  const textDocument = textSource ? await fetchBillTextDocument(textSource.url) : null;

  const selectedVote = selected?.voteId ? votes.find((item) => item.id === selected.voteId) : undefined;
  const amendmentText = splitAmendmentText(selected?.amendmentText);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Bill"
        title={`${bill.number} — ${bill.title}`}
        description={bill.summary}
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={isLiveBillsSource(source)} />}
      />

      {/* States the rule outright. The layout implies it; saying it costs one row and removes any doubt. */}
      <div className="flex items-start gap-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
        <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-full bg-[var(--accent-soft)] text-[var(--accent-2)]">
          <Info className="h-3.5 w-3.5" />
        </span>
        <p className="text-[13px] leading-relaxed text-[var(--muted)]">
          <span className="font-semibold text-[var(--ink)]">Overview and Timeline are the same for every version.</span>{" "}
          Text and Votes below change with the version you select.
        </p>
      </div>

      <BillTabs billId={bill.id} active="version" />

      {entries.length === 0 ? (
        <EmptyState
          title="No stored versions for this bill"
          description="Neither bill text nor amendment votes have been synced for this measure yet."
        />
      ) : (
        <>
          {/* The control and the view switch on one row, directly above what they govern. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] px-4 py-3">
            <div className="min-w-0 flex-1">
              <BillVersionSelect
                entries={entries}
                selectedId={selected?.id ?? entries[0].id}
                billId={bill.id}
                view={view}
              />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent-2)] bg-[var(--accent-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-2)]">
              Controls Text + Votes
            </span>
            <div className="flex shrink-0 gap-1 rounded-[var(--r-sm)] border border-[var(--line-2)] p-0.5">
              {(["text", "votes"] as const).map((option) => (
                <Link
                  key={option}
                  href={`/bills/${encodeURIComponent(bill.id)}/version?v=${encodeURIComponent(selected?.id ?? "")}&view=${option}`}
                  aria-current={view === option ? "page" : undefined}
                  className={cn(
                    "rounded-[6px] px-3.5 py-1.5 text-[13px] font-semibold capitalize transition",
                    view === option
                      ? "bg-[var(--accent-soft)] text-[var(--accent-2)]"
                      : "text-[var(--muted)] hover:text-[var(--ink)]",
                  )}
                >
                  {option}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-4">
              {selected?.kind === "amendment" ? (
                <div className="rounded-[var(--r-md)] border border-[var(--line-2)] bg-[var(--panel-2)] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--accent-2)]">
                    Proposed amendment
                  </p>
                  <p className="mt-1.5 text-[15px] font-semibold text-[var(--ink)]">
                    {selected.label}
                    {selected.sponsor ? (
                      <span className="ml-2 text-[13px] font-medium text-[var(--muted)]">
                        offered by {selected.sponsor}
                      </span>
                    ) : null}
                  </p>
                  {selected.summary ? (
                    <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{selected.summary}</p>
                  ) : null}

                  {/*
                    The amendment's own words, where the Rules Committee PDF yielded them. The
                    instruction line is separated because it is the sentence that says where the
                    change lands -- "At the end of subtitle A of title XI, insert the following new
                    section:" -- which is what ties the amendment to the text below.
                  */}
                  {amendmentText ? (
                    <div className="mt-3 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--panel)] p-3">
                      {amendmentText.instruction ? (
                        <p className="mb-2 border-l-2 border-[var(--accent-2)] bg-[var(--accent-soft)] px-2.5 py-1.5 text-[12px] font-semibold leading-relaxed text-[var(--accent-2)]">
                          {amendmentText.instruction}
                        </p>
                      ) : null}
                      <pre className="num max-h-[26rem] overflow-auto whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-[var(--ink)]">
                        {amendmentText.body}
                      </pre>
                    </div>
                  ) : null}

                  {selected.sourceUrl ? (
                    <a
                      href={selected.sourceUrl}
                      className="mt-2.5 inline-block text-[12px] font-semibold text-[var(--accent-2)]"
                    >
                      {amendmentText ? "Amendment on congress.gov →" : "Official amendment text →"}
                    </a>
                  ) : null}
                </div>
              ) : null}

              {view === "text" ? (
                <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-4">
                  <p className="mb-3 text-[12px] text-[var(--faint)]">
                    {selected?.kind === "amendment"
                      ? `The bill text this amendment was proposed against — ${baseText?.label ?? "unknown"}${baseText?.date ? `, ${baseText.date}` : ""}`
                      : `${selected?.label}${selected?.date ? ` — ${selected.date}` : ""}`}
                  </p>
                  {textDocument ? (
                    <BillTextViewer
                      document={textDocument}
                      versionLabel={baseText?.label}
                      sourceUrl={baseText?.sourceUrl}
                    />
                  ) : (
                    <EmptyState
                      title="No readable text for this version"
                      description="congress.gov did not return a machine-readable document. The official source is linked in the version details."
                    />
                  )}
                </div>
              ) : (
                <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-4">
                  {selectedVote ? (
                    <>
                      <p className="text-[13px] font-semibold text-[var(--ink)]">
                        {selectedVote.question || selectedVote.title}
                      </p>
                      <p className="mt-1 text-[12px] text-[var(--muted)]">
                        {selectedVote.chamber} · {selectedVote.dateLabel} · {selectedVote.result}
                      </p>
                      <Link
                        href={voteHref(bill.id, selectedVote.id)}
                        className="mt-3 inline-block text-[12px] font-semibold text-[var(--accent-2)]"
                      >
                        Full roll call — every member’s vote →
                      </Link>
                    </>
                  ) : (
                    <EmptyState
                      title="No recorded vote on this version"
                      description="This version was not decided by a recorded roll call — amendments are often agreed to by voice vote, and a bill text is only voted on at passage."
                    />
                  )}
                </div>
              )}
            </div>

            {/* Always present, on both views: the tally is what a version is usually looked up for. */}
            <aside className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-4">
              <p className="text-[13px] font-semibold text-[var(--ink)]">Vote on this version</p>
              {selected?.tally && selectedVote ? (
                <>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                    {selectedVote.chamber} — {selected.date}
                  </p>
                  <p className="mt-0.5 text-[12px] font-semibold text-[var(--ink)]">{selected.result}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2">
                    {([
                      ["Yea", selected.tally.yea, "var(--success)"],
                      ["Nay", selected.tally.nay, "var(--danger)"],
                      ["Present", selected.tally.present, "var(--warning)"],
                      ["Not voting", selected.tally.notVoting, "var(--muted)"],
                    ] as const).map(([label, value, tone]) => (
                      <div
                        key={label}
                        className="rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2"
                      >
                        <dt className="text-[11px] font-semibold" style={{ color: tone }}>{label}</dt>
                        <dd className="num mt-0.5 text-[18px] font-semibold text-[var(--ink)]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
                  No recorded roll call for this version.
                </p>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
