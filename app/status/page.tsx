import { CheckCircle2, Clock, TriangleAlert } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { checkSyncHealth, PIPELINE_LABELS } from "@/lib/server/sync-health";

export const revalidate = 1800;

function age(iso: string | null, now: number) {
  if (!iso) return "not in the last 9 days";
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/**
 * When each dataset last updated, and whether its sync is healthy. The same check fails the
 * nightly workflow (lib/server/sync-health.ts); this is the public face of it, without the raw
 * errors.
 */
export default async function StatusPage() {
  const health = await checkSyncHealth({ cached: true }).catch(() => null);
  const now = Date.parse(health?.checkedAt ?? new Date().toISOString());
  const problems = new Map((health?.issues ?? []).map((issue) => [issue.pipeline, issue]));
  const rows = Object.entries(PIPELINE_LABELS).map(([pipeline, label]) => ({
    pipeline,
    label,
    lastSuccessAt: health?.lastSuccessAt[pipeline] ?? null,
    problem: problems.get(pipeline),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Status"
        title="Data status"
        description="Politica copies public records from Congress.gov, the House and Senate clerks, the FEC and the Senate's lobbying disclosures on a nightly schedule. This is when each part last updated."
        actions={
          health ? (
            <Badge tone={health.ok ? "emerald" : "amber"} dot>
              {health.ok ? "All syncs healthy" : `${health.issues.length} need attention`}
            </Badge>
          ) : undefined
        }
      />

      <Card>
        <CardHeader title="Datasets" count={rows.length} />
        <CardBody tight>
          {health ? (
            rows.map((row) => (
              <div
                key={row.pipeline}
                className="flex items-center gap-3 border-b border-[var(--line)] px-2 py-3 last:border-b-0"
              >
                <span className={row.problem ? "text-[var(--warning)]" : "text-[var(--success)]"}>
                  {row.problem ? <TriangleAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium text-[var(--ink)]">{row.label}</span>
                  {row.problem ? (
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      {row.problem.kind === "stale"
                        ? "Has not updated on schedule."
                        : row.problem.kind === "behind"
                          ? "Catching up on a backlog."
                          : "Last update ran but did not complete its work."}
                    </span>
                  ) : null}
                </span>
                <span className="num flex flex-none items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Clock className="h-3.5 w-3.5 text-[var(--faint)]" aria-hidden="true" />
                  {age(row.lastSuccessAt, now)}
                </span>
              </div>
            ))
          ) : (
            <p className="px-2 py-5 text-[13px] text-[var(--muted)]">Sync history is unavailable right now.</p>
          )}
        </CardBody>
        <CardNote>
          Nightly datasets update around 10:30 UTC. Candidates, search and issue pages rebuild weekly. When a sync breaks,
          the nightly run fails and the maintainers are notified.
        </CardNote>
      </Card>
    </div>
  );
}
