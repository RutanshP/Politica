import { notFound } from "next/navigation";

import { CommitteeTabsView } from "@/components/committee-tabs-view";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import {
  getCommitteeData,
  getCommitteeRouteParams,
  getCommitteeSourceLabel,
  isLiveCommitteeSource,
} from "@/lib/data/committees";
import { countStoredBillsByCommitteeId, listStoredBillsByCommitteeId } from "@/lib/supabase/bills";
import { listStoredPoliticiansByIds } from "@/lib/supabase/politicians";
import { deriveCommitteeSector } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export async function generateStaticParams() {
  return getCommitteeRouteParams();
}

export const revalidate = 21600;

export default async function CommitteePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { committee, source } = await getCommitteeData(slug);
  if (!committee) notFound();

  const [members, bills, billsCount] = await Promise.all([
    // Only this committee's roster. Loading every politician to filter it down was the single
    // largest egress cost in the app -- ~3MB per committee page, 380+ of them per build.
    listStoredPoliticiansByIds(committee.memberIds),
    // Bills referred to this committee, read live from bills.committee_id (every bill carries it)
    // rather than the sparsely-populated committees.active_bill_ids array.
    listStoredBillsByCommitteeId(committee.id).catch(() => [] as Bill[]),
    countStoredBillsByCommitteeId(committee.id).catch(() => 0),
  ]);
  const sector = deriveCommitteeSector(committee);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={committee.chamber}
        title={committee.name}
        description={committee.description}
        actions={
          <SourceBadge
            label={getCommitteeSourceLabel(source)}
            live={isLiveCommitteeSource(source)}
          />
        }
      />
      <CommitteeTabsView
        committee={committee}
        members={members}
        bills={bills}
        billsCount={billsCount}
        sector={sector}
      />
    </div>
  );
}
