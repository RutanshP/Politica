import { BillsDirectory } from "@/components/bills-directory";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import {
  getBillsData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { getCommitteesData } from "@/lib/data/committees";
import { getPoliticiansData } from "@/lib/data/politicians";

export const revalidate = 21600;

export default async function BillsPage() {
  const [{ bills, source }, { politicians }, { committees }] = await Promise.all([
    getBillsData(),
    getPoliticiansData(),
    getCommitteesData(),
  ]);
  const live = isLiveBillsSource(source);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bills explorer"
        title="Explore legislation"
        description="Search and filter legislation across chambers, committees, sponsors, sessions, and issue clusters."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />
      <SectionCard title="Bills table" description="Every row links deeper into the bill, committee, and sponsor profile.">
        <BillsDirectory bills={bills} politicians={politicians} committees={committees} />
      </SectionCard>
    </div>
  );
}
