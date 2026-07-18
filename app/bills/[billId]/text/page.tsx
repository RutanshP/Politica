import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import { BillTextViewer } from "@/components/bill-text-viewer";
import { fetchBillTextDocument, pickBillTextSource } from "@/lib/adapters/bill-text";
import {
  getBillData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";

export const revalidate = 21600;

export default async function BillTextPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const { bill, source } = await getBillData(billId);
  if (!bill) notFound();
  const live = isLiveBillsSource(source);

  const versions = bill.versions.length > 0 ? bill.versions : [];

  // Fetch and parse the official text on-demand from the best version's document link. This is a
  // plain cached document fetch from congress.gov -- it does not touch the rate-limited API.
  const textSource = pickBillTextSource(versions);
  const textDocument = textSource ? await fetchBillTextDocument(textSource.url) : null;
  const displayVersion = textSource?.version ?? versions[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bill text"
        title={`${bill.number} - ${bill.title}`}
        description="Stored document versions, searchable text, and version comparison scaffolding for this bill."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <Tabs
        items={[
          { label: "Overview", href: `/bills/${bill.id}` },
          { label: "Timeline", href: `/bills/${bill.id}/timeline` },
          { label: "Text", href: `/bills/${bill.id}/text`, active: true },
          { label: "Votes", href: `/bills/${bill.id}/votes` },
          { label: "News", href: "/news" },
        ]}
      />
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
            <EmptyState
              title="Inline text unavailable for this version"
              description="The formatted bill text could not be loaded right now. You can open the official document directly."
            />
            <div className="grid gap-3 md:grid-cols-2">
              {versions.map((version) => (
                <div key={version.id} className="rounded-2xl border border-[var(--line)] bg-white p-4">
                  <p className="text-sm font-semibold text-[var(--ink)]">{version.label}</p>
                  <p className="mt-1 text-sm text-[var(--muted)]">{version.date}</p>
                  {version.sourceUrl ? (
                    <a href={version.sourceUrl} className="mt-2 inline-block text-sm font-semibold text-[var(--accent)]">
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
