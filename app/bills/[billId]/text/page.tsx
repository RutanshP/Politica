import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { BillTabs } from "@/components/bill-tabs";
import { BillTextViewer } from "@/components/bill-text-viewer";
import {
  fetchBillTextDocument,
  hasReadableBillText,
  orderBillTextVersions,
  resolveBillTextSource,
} from "@/lib/adapters/bill-text";
import {
  getBillData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { cn } from "@/lib/utils";

export const revalidate = 21600;

export default async function BillTextPage({
  params,
  searchParams,
}: {
  params: Promise<{ billId: string }>;
  searchParams: Promise<{ version?: string }>;
}) {
  const { billId: rawBillId } = await params;
  const { version: requestedVersionId } = await searchParams;
  const { bill, source } = await getBillData(decodeURIComponent(rawBillId));
  if (!bill) notFound();
  const live = isLiveBillsSource(source);

  const versions = orderBillTextVersions(bill.versions.length > 0 ? bill.versions : []);

  /*
   * Each version resolves to its own document. The tab used to render one version -- whichever
   * pickBillTextSource judged most authoritative -- and offered no way to read the others, even
   * though a bill can carry nine stored versions and every one of them has its own link. The
   * requested version wins; without one, the same default as before.
   *
   * Still a plain cached document fetch from congress.gov -- it does not touch the rate-limited API.
   */
  const textSource = resolveBillTextSource(versions, requestedVersionId);
  const textDocument = textSource ? await fetchBillTextDocument(textSource.url) : null;
  const displayVersion = textSource?.version ?? versions[0];
  const readableVersions = versions.filter(hasReadableBillText);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bill text"
        title={`${bill.number} - ${bill.title}`}
        description="Stored document versions, searchable text, and version comparison scaffolding for this bill."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <BillTabs billId={bill.id} active="text" />
      {/*
        One chip per version that has readable text, newest first. Plain links rather than a client
        component: the page is server-rendered and each version is its own cached fetch, so a
        selection is just another URL -- shareable, and it survives a reload.
      */}
      {readableVersions.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {readableVersions.map((version) => {
            const active = version.id === displayVersion?.id;
            return (
              <Link
                key={version.id}
                href={`/bills/${encodeURIComponent(bill.id)}/text?version=${encodeURIComponent(version.id)}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[13px] font-semibold transition",
                  active
                    ? "border-[var(--accent-2)] bg-[var(--accent-soft)] text-[var(--accent-2)]"
                    : "border-[var(--line)] bg-[var(--panel-2)] text-[var(--muted)] hover:border-[var(--line-2)] hover:text-[var(--ink)]",
                )}
              >
                {version.label}
                {version.date ? (
                  <span className="num ml-1.5 font-normal opacity-70">{version.date}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      ) : null}
      <SectionCard
        title={displayVersion?.label ? `${displayVersion.label}${displayVersion.date ? ` · ${displayVersion.date}` : ""}` : "Bill text"}
        description={
          textDocument
            ? "Official bill text, formatted for reading. Long bills open by section — expand what you want."
            : "Official document links for this bill."
        }
      >
        {textDocument ? (
          <BillTextViewer
            document={textDocument}
            versionLabel={displayVersion?.label}
            sourceUrl={displayVersion?.sourceUrl}
          />
        ) : versions.length > 0 ? (
          // Fallback: the text could not be fetched/parsed (site unreachable, no XML, etc.).
          <div className="space-y-4">
            {/*
              Two different situations, and conflating them made a transient upstream failure look
              like a permanent property of the bill.
            */}
            <EmptyState
              title={
                textSource
                  ? "Could not load the formatted text right now"
                  : "No inline text published for this version"
              }
              description={
                textSource
                  ? "congress.gov did not return a readable document for this version. This is usually temporary — reload in a moment, or open the official document directly."
                  : "This version has no machine-readable document to render inline. The official document is linked below."
              }
            />
            <div className="grid gap-3 md:grid-cols-2">
              {versions.map((version) => (
                <div key={version.id} className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">{version.label}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{version.date}</p>
                  {version.sourceUrl ? (
                    <a href={version.sourceUrl} className="mt-2 inline-block text-sm font-semibold text-[var(--accent-2)]">
                      Open official source
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No stored text versions yet"
            description="This bill is stored, but detailed text versions have not been synced into stored bill history yet."
          />
        )}
      </SectionCard>
    </div>
  );
}
