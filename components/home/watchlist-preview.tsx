"use client";

import { Star } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ListRow } from "@/components/ui/list-row";
import { IconTile } from "@/components/ui/icon-tile";
import { TopicIcon } from "@/components/ui/topic-icon";
import { useWatchlist } from "@/lib/watchlist-store";

/**
 * Home's watchlist card. Reads the browser-local watchlist directly, so it reflects anything
 * starred anywhere in the app without a round trip.
 */
export function WatchlistPreview() {
  const { items, ready } = useWatchlist();

  if (!ready) {
    // Avoids flashing the empty state before localStorage has been read on first paint.
    return <div className="h-24" aria-hidden="true" />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing watched yet"
        description="Star a bill, member, or committee anywhere in Politica and it will show up here."
        actionLabel="Browse bills"
        actionHref="/bills"
      />
    );
  }

  return (
    <>
      {items.slice(0, 4).map((item) => (
        <ListRow
          key={item.id}
          href={item.href}
          leading={
            <IconTile tone="indigo">
              <TopicIcon topic={item.type} />
            </IconTile>
          }
          title={item.label}
          subtitle={item.subtitle}
          trailing={<Star className="h-3.5 w-3.5 fill-current text-[var(--warning)]" />}
        />
      ))}
    </>
  );
}
