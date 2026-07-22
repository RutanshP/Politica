import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { SponsoredBillsList } from "@/components/sponsored-bills-list";
import {
  getPoliticianData,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export const revalidate = 21600;

export default async function PoliticianBillsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const sponsoredBills = await getSponsoredBillsForPolitician(slug);
  const careerTotal = politician.stats.billsIntroduced;
  // careerTotal is the official source's count across all Congresses; sponsoredBills
  // are the ones inside our synced bill window. The gap is expected, not missing data.
  const tracksSubset = careerTotal > sponsoredBills.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sponsored bills"
        title={politician.name}
        description="Every bill this member has sponsored that is tracked in the current dataset."
        actions={<SourceBadge label={getPoliticianSourceLabel(source)} live={isLivePoliticianSource(source)} />}
      />
      <PoliticianTabs slug={politician.slug} active="bills" />
      <SectionCard
        title={`Sponsored legislation (${sponsoredBills.length})`}
        description={tracksSubset
          ? `Congress.gov reports ${careerTotal.toLocaleString()} sponsored bills across ${politician.name}'s full career. This app tracks a recent window of legislation, so ${sponsoredBills.length.toLocaleString()} of them are stored here.`
          : "All sponsored bills tracked for this member."}
      >
        {sponsoredBills.length > 0 ? (
          <SponsoredBillsList bills={sponsoredBills} />
        ) : (
          <EmptyState
            title="No stored sponsored bills in the current dataset"
            description="This profile is connected, but the currently synced bill window does not yet include sponsored legislation for this member."
            actionLabel="Open bills"
            actionHref="/bills"
          />
        )}
      </SectionCard>
    </div>
  );
}
