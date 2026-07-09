import Link from "next/link";

import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { WatchButton } from "@/components/watch-button";
import {
  getPoliticianSourceLabel,
  getPoliticiansData,
  isLivePoliticianSource,
} from "@/lib/data/politicians";

export const revalidate = 21600;

export default async function PoliticiansPage() {
  const { politicians, source } = await getPoliticiansData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Politicians"
        title="Profiles and legislative behavior"
        description="Browse member snapshots with connected access to voting behavior, funding, committees, bills, biography, and issue activity."
        actions={
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
        }
      />
      <SectionCard title="Member directory">
        <DataTable
          columns={["Name", "Office", "Party", "State", "Attendance", "Profile", "Watch"]}
          rows={politicians.map((politician) => [
            politician.name,
            politician.title,
            politician.party,
            politician.state,
            `${politician.stats.attendance}%`,
            <Link key={politician.id} href={`/politicians/${politician.slug}`} className="font-semibold text-[var(--accent)]">
              View profile
            </Link>,
            <WatchButton key={`${politician.id}-watch`} />,
          ])}
        />
      </SectionCard>
    </div>
  );
}
