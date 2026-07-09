import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";

export default function ElectionsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Elections"
        title="Election intelligence scaffolding"
        description="Reserved for future race calendars, ballot measures, fundraising snapshots, and district competitiveness overlays."
      />
      <SectionCard title="Coming next">
        <p className="text-sm text-[var(--muted)]">
          This MVP keeps the navigation entry live and the data model ready without overbuilding election-specific UX before the core legislative flows.
        </p>
      </SectionCard>
    </div>
  );
}
