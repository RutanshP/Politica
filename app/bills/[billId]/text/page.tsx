import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import {
  getBillData,
  getBillRouteParams,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";

export async function generateStaticParams() {
  return getBillRouteParams();
}

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
  const latestVersion = versions[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bill text"
        title={`${bill.number} - ${bill.title}`}
        description="Document versions, searchable text, and version comparison scaffolding using the current live bill text metadata."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <Tabs
        items={[
          { label: "Overview", href: `/bills/${bill.id}` },
          { label: "Text", href: `/bills/${bill.id}/text`, active: true },
          { label: "Votes", href: `/bills/${bill.id}/votes` },
          { label: "News", href: "/news" },
        ]}
      />
      <section className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_280px]">
        <SectionCard title="Document versions">
          <div className="space-y-3">
            {versions.map((version, index) => (
              <div
                key={version.id}
                className={`rounded-2xl border p-4 ${
                  index === 0
                    ? "border-blue-200 bg-blue-50"
                    : "border-[var(--line)] bg-white"
                }`}
              >
                <p className="text-sm font-semibold text-[var(--ink)]">
                  {version.label}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">{version.date}</p>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title={latestVersion?.label ?? "Text unavailable"} description="Latest bill text with search, download, and compare affordances.">
          <div className="mb-5 flex flex-wrap gap-3">
            <button className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold">
              Original
            </button>
            <button className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold">
              Compare
            </button>
            <button className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold">
              Download
            </button>
          </div>
          <div className="rounded-[28px] border border-[var(--line)] bg-white px-6 py-8">
            {latestVersion ? (
              <div className="space-y-6">
                {latestVersion.content.map((paragraph) => (
                  <p key={paragraph} className="text-sm leading-7 text-slate-700">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                This bill does not have live text metadata available yet.
              </p>
            )}
          </div>
        </SectionCard>
        <SectionCard title="Compare versions">
          <div className="space-y-4">
            <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-800">
              Added provisions are shown here when multiple live text versions exist.
            </div>
            <div className="rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">
              Removed provisions are shown here when multiple live text versions exist.
            </div>
            <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
              Changed provisions are shown here when multiple live text versions exist.
            </div>
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
