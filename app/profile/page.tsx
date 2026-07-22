import Link from "next/link";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { StatCard } from "@/components/stat-card";
import { getAnalyticsData } from "@/lib/data/analytics";
import { getWatchlistData } from "@/lib/data/watchlist";

export default async function ProfilePage() {
  const [{ items }, { summary }] = await Promise.all([
    getWatchlistData(),
    getAnalyticsData(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Profile"
        title="Politica workspace"
        description="A shared workspace summary built from the current stored intelligence graph."
      />
      <section className="grid gap-4 md:grid-cols-3">
        <StatCard label="Tracked entities" value={items.length} detail="Bills, politicians, committees, and issues currently shown in the app-level watchlist." />
        <StatCard label="Active bills" value={summary.activeBills} detail="Bills currently available in stored datasets." />
        <StatCard label="Watchlist hits" value={summary.watchlistHits} detail="Cross-entity activity derived from the current stored data." />
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <SectionCard title="Workspace summary">
          <div className="space-y-4 text-sm text-[var(--muted)]">
            <p>Mode: Shared app-level workspace</p>
            <p>Coverage: Congress.gov, FEC, OpenStates, and News API when configured</p>
            <p>Focus: Federal and state legislation, committees, finance flows, and issue-level monitoring.</p>
            <p>Current stored alerts: {summary.upcomingVotes} upcoming vote signals across tracked bills.</p>
          </div>
        </SectionCard>
        <SectionCard title="Quick links">
          <div className="space-y-3">
            {[
              ["/watchlist", "Open watchlist"],
              ["/analytics", "Open analytics"],
              ["/money/graph", "Open funding graph"],
              ["/search", "Open global search"],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="block rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] px-4 py-3 font-semibold text-[var(--accent-2)]"
              >
                {label}
              </Link>
            ))}
          </div>
        </SectionCard>
      </section>
    </div>
  );
}
