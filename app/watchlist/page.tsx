import { Activity, Star } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { WatchlistView, type ActivityEntry } from "@/components/watchlist/watchlist-view";
import { Card, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
import { Tabs } from "@/components/ui/tabs";
import { getNewsData } from "@/lib/data/news";
import { getWatchlistData } from "@/lib/data/watchlist";
import { listRecentStoredBills } from "@/lib/supabase/bills";
import { billHref } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export const revalidate = 21600;

/*
 * Two tabs, both real: what you have pinned, and the activity on it. Alert rules, saved searches
 * and email/push delivery used to sit here as tabs and cards marked "layout only" -- each needs an
 * account backend that does not exist, so they promised features the site cannot deliver.
 */
type WatchlistTab = "watchlist" | "activity";

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  // "alerts" was the old name of the activity tab; old links still land on it.
  const tab: WatchlistTab = rawTab === "activity" || rawTab === "alerts" ? "activity" : "watchlist";

  const [{ items: suggested, availability }, recentBills, { news }] = await Promise.all([
    getWatchlistData(),
    listRecentStoredBills(20).catch(() => [] as Bill[]),
    getNewsData(),
  ]);

  /*
   * The feed is built server-side from real stored records and shipped whole; the client filters
   * it down to watched ids. Doing the filter on the client is what lets a browser-local watchlist
   * personalize a statically-rendered page.
   */
  const activity: ActivityEntry[] = [
    ...recentBills.map((bill) => ({
      id: `bill-${bill.id}`,
      relatedIds: [bill.id, bill.sponsorId, bill.committeeId].filter(Boolean),
      kind: "bill-action" as const,
      title: `${bill.number} · ${bill.latestAction}`,
      body: bill.title,
      href: billHref(bill.id),
      timestamp: bill.lastActionAt,
      tags: [bill.number, bill.chamber, bill.status],
    })),
    ...news.map((item) => ({
      id: `news-${item.id}`,
      relatedIds: item.relatedIds,
      kind: "news" as const,
      title: item.headline,
      body: item.summary,
      href: "/news",
      timestamp: item.publishedAt,
      tags: [item.source, "News"],
    })),
  ];

  const tabItems = [
    { label: "Watchlist", href: "/watchlist", icon: <Star />, active: tab === "watchlist" },
    { label: "Activity", href: "/watchlist?tab=activity", icon: <Activity />, active: tab === "activity" },
  ];

  return (
    <div>
      <PageHeader
        title="Watchlist"
        description="Everything you are tracking, and what has moved on it."
        actions={
          <SourceBadge
            label={
              availability === "live"
                ? "Stored entities available"
                : "Watchlist awaiting stored entities"
            }
            live={availability === "live"}
          />
        }
      />

      <Tabs className="mb-4" items={tabItems} />

      <WithRail
        rail={
          <>
            <Card>
              <CardHeader title="Where this is stored" />
              <CardNote>
                Your watchlist lives in this browser. Starring anything anywhere in Politica pins
                it here, and it stays across reloads and tabs on this device.
              </CardNote>
            </Card>
          </>
        }
      >
        <WatchlistView tab={tab} suggested={suggested} activity={activity} />
      </WithRail>
    </div>
  );
}
