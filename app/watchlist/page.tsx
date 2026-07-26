import { Bell, Mail, Search, Star } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { WatchlistView, type ActivityEntry } from "@/components/watchlist/watchlist-view";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
import { Tabs } from "@/components/ui/tabs";
import { getNewsData } from "@/lib/data/news";
import { getWatchlistData } from "@/lib/data/watchlist";
import { listRecentStoredBills } from "@/lib/supabase/bills";
import { billHref } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export const revalidate = 21600;

const TABS = ["watchlist", "alerts", "saved", "notifications"] as const;
type WatchlistTab = (typeof TABS)[number];

/** Alert rules and delivery are layout-only until there is an account backend to store them. */
const RULE_SHELLS = [
  { title: "Bill actions", detail: "Any action on a watched bill" },
  { title: "Floor votes", detail: "Roll calls on watched bills" },
  { title: "Committee hearings", detail: "Watched committees" },
];

const DELIVERY_SHELLS = [
  { title: "Email digest", icon: Mail },
  { title: "Push notifications", icon: Bell },
];

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: WatchlistTab = TABS.includes(rawTab as WatchlistTab)
    ? (rawTab as WatchlistTab)
    : "watchlist";

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
    { label: "Alerts", href: "/watchlist?tab=alerts", icon: <Bell />, active: tab === "alerts" },
    {
      label: "Saved searches",
      href: "/watchlist?tab=saved",
      icon: <Search />,
      active: tab === "saved",
    },
    {
      label: "Notifications",
      href: "/watchlist?tab=notifications",
      icon: <Mail />,
      active: tab === "notifications",
    },
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
              <CardHeader title="Custom alert rules" />
              <CardBody className="gap-2.5">
                {RULE_SHELLS.map((rule) => (
                  <div
                    key={rule.title}
                    className="rounded-[var(--r-sm)] border border-dashed border-[var(--line-2)] px-3 py-2.5"
                  >
                    <p className="text-[13px] text-[var(--muted)]">{rule.title}</p>
                    <p className="text-xs text-[var(--faint)]">{rule.detail}</p>
                  </div>
                ))}
              </CardBody>
              <CardNote>
                Layout only — the rule builder needs an account backend to store rules against.
              </CardNote>
            </Card>

            <Card>
              <CardHeader title="Delivery" />
              <CardBody className="gap-2.5">
                {DELIVERY_SHELLS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <div
                      key={option.title}
                      className="flex items-center gap-2.5 rounded-[var(--r-sm)] border border-dashed border-[var(--line-2)] px-3 py-2.5"
                    >
                      <Icon className="h-4 w-4 flex-none text-[var(--faint)]" />
                      <span className="flex-1 text-[13px] text-[var(--muted)]">
                        {option.title}
                      </span>
                      <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] font-semibold text-[var(--faint)]">
                        Not configured
                      </span>
                    </div>
                  );
                })}
              </CardBody>
            </Card>

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
