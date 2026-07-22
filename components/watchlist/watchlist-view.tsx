"use client";

import { Bell, FileText, Landmark, Newspaper, Scale, Star, Vote, X } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink, IconButton } from "@/components/ui/button";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { topicVisual } from "@/components/ui/topic-icon";
import type { Tone } from "@/components/ui/tones";
import { useWatchlist, type WatchedItem } from "@/lib/watchlist-store";
import type { EntityType, WatchlistItem } from "@/types/civic";

/** One derived activity item, built server-side from stored records. */
export interface ActivityEntry {
  id: string;
  /** Ids this entry relates to; matched against watched ids to build the personal feed. */
  relatedIds: string[];
  kind: "bill-action" | "vote" | "news";
  title: string;
  body: string;
  href: string;
  timestamp: string;
  tags: string[];
}

const TYPE_ICON: Record<string, { Icon: React.ComponentType<{ className?: string }>; tone: Tone }> =
  {
    bill: { Icon: FileText, tone: "indigo" },
    politician: { Icon: Star, tone: "sky" },
    committee: { Icon: Landmark, tone: "emerald" },
    issue: { Icon: Scale, tone: "amber" },
    vote: { Icon: Vote, tone: "sky" },
  };

const KIND_ICON: Record<ActivityEntry["kind"], { Icon: React.ComponentType<{ className?: string }>; tone: Tone }> =
  {
    "bill-action": { Icon: FileText, tone: "emerald" },
    vote: { Icon: Vote, tone: "sky" },
    news: { Icon: Newspaper, tone: "amber" },
  };

function entityVisual(type: EntityType | string, label: string) {
  return TYPE_ICON[type] ?? { Icon: topicVisual(label).Icon, tone: topicVisual(label).tone };
}

function PinCard({
  item,
  onRemove,
  suggested,
}: {
  item: { id: string; type: string; label: string; subtitle?: string; href: string };
  onRemove?: () => void;
  suggested?: boolean;
}) {
  const { Icon, tone } = entityVisual(item.type, item.label);

  return (
    <div className="relative flex flex-col gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel-2)] p-3.5 transition hover:border-[var(--line-2)]">
      {onRemove ? (
        <IconButton
          label={`Remove ${item.label} from watchlist`}
          onClick={onRemove}
          className="absolute right-1.5 top-1.5 h-7 w-7"
        >
          <X />
        </IconButton>
      ) : (
        <Star className="absolute right-3 top-3 h-3.5 w-3.5 text-[var(--faint)]" />
      )}

      <IconTile tone={tone} size="lg">
        <Icon />
      </IconTile>
      <Link href={item.href} className="min-w-0">
        <span className="line-clamp-3 text-[13.5px] font-semibold leading-snug">{item.label}</span>
        {item.subtitle ? (
          <span className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">
            {item.subtitle}
          </span>
        ) : null}
      </Link>
      <div className="mt-auto flex flex-wrap gap-1.5">
        <Badge tone="slate">{item.type}</Badge>
        {suggested ? <Badge tone="indigo">Suggested</Badge> : null}
      </div>
    </div>
  );
}

function AlertFeed({
  entries,
  personalized,
}: {
  entries: ActivityEntry[];
  personalized: boolean;
}) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No recent activity"
        description="Nothing has moved on the entities you're watching in the current stored dataset."
      />
    );
  }

  return (
    <>
      {entries.map((entry) => {
        const { Icon, tone } = KIND_ICON[entry.kind];
        return (
          <div
            key={entry.id}
            className="flex items-start gap-3 border-b border-[var(--line)] py-3.5 last:border-b-0"
          >
            <IconTile tone={tone}>
              <Icon />
            </IconTile>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">{entry.title}</p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{entry.body}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {entry.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </div>
            </div>
            <div className="flex flex-none items-center gap-2.5">
              <span className="num text-[11.5px] text-[var(--faint)]">{entry.timestamp}</span>
              {personalized ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-2)]" /> : null}
              <ButtonLink href={entry.href} size="sm">
                Open
              </ButtonLink>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function WatchlistView({
  tab,
  suggested,
  activity,
}: {
  tab: "watchlist" | "alerts" | "saved" | "notifications";
  /** Derived starter entities, shown only when the browser watchlist is empty. */
  suggested: WatchlistItem[];
  activity: ActivityEntry[];
}) {
  const { items, ready, remove } = useWatchlist();

  const watchedIds = new Set(items.map((item) => item.id));
  const personalized = items.length > 0;
  const feed = personalized
    ? activity.filter((entry) => entry.relatedIds.some((id) => watchedIds.has(id)))
    : activity;

  if (!ready) {
    // Avoid rendering the "suggested" state before localStorage has been read.
    return <div className="h-64" aria-busy="true" />;
  }

  if (tab === "saved") {
    return (
      <Card>
        <CardHeader title="Saved searches" />
        <CardBody>
          <EmptyState
            title="Saved searches aren't available yet"
            description="Filter sets in the Bills Explorer are shareable by URL today. Named, saved searches need an account backend."
            actionLabel="Open Bills Explorer"
            actionHref="/bills"
          />
        </CardBody>
      </Card>
    );
  }

  if (tab === "notifications") {
    return (
      <Card>
        <CardHeader title="Notifications" />
        <CardBody>
          <EmptyState
            title="Delivery isn't configured"
            description="Email and push delivery require an account backend. Until then, the alert feed on this page is the live view of activity on what you watch."
            actionLabel="View alerts"
            actionHref="/watchlist?tab=alerts"
          />
        </CardBody>
      </Card>
    );
  }

  if (tab === "alerts") {
    return (
      <Card>
        <CardHeader title={personalized ? "Activity on your watchlist" : "Recent across Congress"} icon={<Bell />} />
        <CardBody>
          <AlertFeed entries={feed} personalized={personalized} />
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Card>
        <CardHeader
          title={personalized ? "Pinned entities" : "Suggested to watch"}
          count={personalized ? items.length : undefined}
        />
        <CardBody>
          {personalized ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {items.map((item: WatchedItem) => (
                <PinCard key={item.id} item={item} onRemove={() => remove(item.id)} />
              ))}
            </div>
          ) : suggested.length > 0 ? (
            <>
              <p className="mb-3.5 text-[13px] text-[var(--muted)]">
                You have not watched anything yet. Star any bill, member, or committee and it
                will be pinned here. In the meantime, here is what is active in the dataset.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {suggested.map((item) => (
                  <PinCard
                    key={item.id}
                    item={{
                      id: item.id,
                      type: item.type,
                      label: item.label,
                      subtitle: item.status,
                      href: item.href,
                    }}
                    suggested
                  />
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="Nothing to watch yet"
              description="Run a sync to populate bills, members, and committees, then star what you care about."
              actionLabel="Open bills"
              actionHref="/bills"
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={personalized ? "Activity on your watchlist" : "Recent across Congress"}
          icon={<Bell />}
        />
        <CardBody>
          <AlertFeed entries={feed.slice(0, 6)} personalized={personalized} />
        </CardBody>
        <CardFooter label="View all alerts" href="/watchlist?tab=alerts" />
      </Card>
    </div>
  );
}
