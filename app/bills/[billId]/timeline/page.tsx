import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import { Timeline } from "@/components/timeline";
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

export default async function BillTimelinePage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const { bill, source } = await getBillData(billId);
  if (!bill) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bill timeline"
        title={`${bill.number} · ${bill.title}`}
        description="Track every committee and floor milestone in a dedicated timeline view."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={isLiveBillsSource(source)} />}
      />
      <Tabs
        items={[
          { label: "Overview", href: `/bills/${bill.id}` },
          { label: "Timeline", href: `/bills/${bill.id}/timeline`, active: true },
          { label: "Text", href: `/bills/${bill.id}/text` },
          { label: "Votes", href: `/bills/${bill.id}/votes` },
          { label: "News", href: "/news" },
        ]}
      />
      <SectionCard title="Legislative timeline">
        <Timeline items={bill.actions} />
      </SectionCard>
    </div>
  );
}
