import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { getSyncStatusData } from "@/lib/data/sync-status";

export default async function MorePage() {
  const { runs } = await getSyncStatusData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="More"
        title="Pipeline health"
        description="Operational visibility for sync jobs, rebuilds, and stored-data freshness across Politica."
      />
      <SectionCard title="Recent sync runs">
        {runs.length > 0 ? (
          <DataTable
            columns={["Pipeline", "Status", "Started", "Finished", "Records", "Error"]}
            rows={runs.slice(0, 12).map((run) => [
              run.pipeline,
              run.status,
              run.started_at,
              run.finished_at || "In progress",
              run.record_count,
              run.error_message || "None",
            ])}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No sync runs have been recorded yet. Trigger the protected sync endpoints to populate pipeline health data.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
