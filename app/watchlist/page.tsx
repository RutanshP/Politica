import { DataTable } from "@/components/data-table";
import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { SourceBadge } from "@/components/source-badge";
import { WatchButton } from "@/components/watch-button";
import { getWatchlistData } from "@/lib/data/watchlist";

export default async function WatchlistPage() {
  const { items, availability } = await getWatchlistData();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Watchlist"
        title="Tracked bills, people, committees, and issues"
        description="A stored starter watchlist built from synced legislative and politician records."
        actions={<SourceBadge label={availability === "live" ? "App-level watchlist seeds" : "Watchlist awaiting stored entities"} live={availability === "live"} />}
      />
      <SectionCard title="Your watchlist">
        {items.length > 0 ? (
          <DataTable
            columns={["Name", "Type", "Last updated", "Status", "Watching"]}
            rows={items.map((item) => [
              <a key={item.id} href={item.href} className="font-semibold text-[var(--accent)]">
                {item.label}
              </a>,
              item.type,
              item.lastUpdated,
              item.status,
              <WatchButton key={`${item.id}-watch`} defaultWatched />,
            ])}
          />
        ) : (
          <p className="text-sm text-[var(--muted)]">
            No stored entities are available to seed the watchlist yet.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
