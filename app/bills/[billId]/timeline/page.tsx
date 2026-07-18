import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { Tabs } from "@/components/tabs";
import { BillProgressStepper } from "@/components/bill-progress";
import { Timeline } from "@/components/timeline";
import {
  getBillData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";

export const revalidate = 21600;

export default async function BillTimelinePage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const { bill, source } = await getBillData(billId);
  if (!bill) notFound();
  const chronologicalActions = bill.actions;

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
      <BillProgressStepper bill={bill} />
      <SectionCard title="Legislative timeline">
        {bill.actions.length > 0 ? (
          <Timeline items={chronologicalActions} />
        ) : (
          <EmptyState
            title="No stored timeline actions yet"
            description="This bill record exists, but detailed action history has not been stored for it yet."
          />
        )}
      </SectionCard>
    </div>
  );
}
