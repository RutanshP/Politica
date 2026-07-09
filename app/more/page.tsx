import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";

export default function MorePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="More"
        title="Platform roadmap"
        description="This area is reserved for alerts, exports, saved comparisons, API sync jobs, and admin tooling as Politica adds more live data sources."
      />
      <SectionCard title="Prepared architecture">
        <ul className="space-y-2 text-sm text-[var(--muted)]">
          <li>Supabase-ready entity model for bills, versions, sponsors, votes, committees, issues, and graph edges.</li>
          <li>Clear component boundaries for reusable dashboards, tables, tabs, and graphs.</li>
          <li>Placeholder hooks for scheduled sync jobs and search-index rebuilds.</li>
        </ul>
      </SectionCard>
    </div>
  );
}
