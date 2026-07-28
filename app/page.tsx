import {
  Activity,
  Building2,
  CalendarClock,
  CheckCircle2,
  FileText,
  Flame,
  Layers,
  Newspaper,
  Scale,
  Star,
  Vote,
} from "lucide-react";
import Link from "next/link";

import { WatchlistPreview } from "@/components/home/watchlist-preview";
import { SourceBadge } from "@/components/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardFooter, CardHeader } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { ListRow, Rank } from "@/components/ui/list-row";
import { MeterRow } from "@/components/ui/meter";
import { StatTile, deltaFromSeries } from "@/components/ui/stat-tile";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { BILL_STATUS_TONE } from "@/components/ui/tones";
import { getDashboardData } from "@/lib/data/dashboard";
import { getIssuesData } from "@/lib/data/issues";
import { billHref, voteHref } from "@/lib/utils";
import type { Bill } from "@/types/civic";

export const revalidate = 21600;

function seriesValue(series: Array<{ label: string; value: number }>, label: string) {
  return series.find((point) => point.label === label)?.value ?? 0;
}

export default async function HomePage() {
  const [{ analytics, feed }, issuesData] = await Promise.all([
    getDashboardData(),
    getIssuesData(),
  ]);

  const live = analytics.activeBills > 0;

  /*
   * Only `introductionsSeries` is an actual time series (buildMonthlySeries in
   * lib/data/analytics.ts), so it is the only tile that can honestly carry a period-over-period
   * delta. `activitySeries` is a status distribution -- comparing its last two points would be
   * "Signed vs Passed", which is not a change over time.
   */
  const introductions = analytics.introductionsSeries;
  const introducedThisPeriod = introductions.at(-1)?.value ?? 0;
  const introductionsDelta = deltaFromSeries(introductions);
  const clearedChamber =
    seriesValue(analytics.activitySeries, "Passed") + seriesValue(analytics.activitySeries, "Signed");

  // Most active issues, ranked by the bill count already stored on each issue.
  const rankedIssues = [...issuesData.issues]
    .sort((left, right) => right.stats.activeBills - left.stats.activeBills)
    .slice(0, 5);
  const issueMax = rankedIssues[0]?.stats.activeBills ?? 0;

  const activity = [
    ...feed.recentlyPassed.slice(0, 2).map((bill) => ({ bill, kind: "passed" as const })),
    ...feed.trendingBills.slice(0, 2).map((bill) => ({ bill, kind: "action" as const })),
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">Welcome back, Alex</h1>
          <p className="mt-1 text-[13.5px] text-[var(--muted)]">
            Here is what has moved across Congress in the current stored dataset.
          </p>
        </div>
        <SourceBadge
          label={live ? "Stored dashboard data" : "Dashboard awaiting stored data"}
          live={live}
        />
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <StatTile
          label="Active bills"
          value={analytics.activeBills.toLocaleString()}
          icon={<FileText />}
          tone="indigo"
          footnote="In the current stored bill set"
        />
        <StatTile
          label="Introduced this period"
          value={introducedThisPeriod.toLocaleString()}
          icon={<Activity />}
          tone="sky"
          delta={introductionsDelta}
          footnote="Latest month vs. the one before"
        />
        <StatTile
          label="Cleared a chamber"
          value={clearedChamber.toLocaleString()}
          icon={<CheckCircle2 />}
          tone="emerald"
          footnote="Passed chamber or signed"
        />
        <StatTile
          label="Upcoming votes"
          value={analytics.upcomingVotes.toLocaleString()}
          icon={<Vote />}
          tone="sky"
          footnote="On the floor or awaiting action"
        />
        <StatTile
          label="Committees tracked"
          value={analytics.committees.toLocaleString()}
          icon={<Building2 />}
          tone="indigo"
          footnote="Committee records stored"
        />
        <StatTile
          label="Tracked issues"
          value={issuesData.issues.length.toLocaleString()}
          icon={<Scale />}
          tone="amber"
          footnote="Linked to stored legislation"
        />
      </div>

      <div className="mb-3.5 grid gap-3.5 xl:grid-cols-3">
        <Card>
          <CardHeader
            title="Legislative activity"
            icon={<Activity />}
            actionLabel="View all"
            actionHref="/bills"
          />
          <CardBody tight>
            {activity.length > 0 ? (
              activity.map(({ bill, kind }) => (
                <ListRow
                  key={`${kind}-${bill.id}`}
                  href={billHref(bill.id)}
                  leading={
                    <IconTile tone={topicVisual(bill.topic).tone}>
                      <TopicIcon topic={bill.topic} />
                    </IconTile>
                  }
                  title={`${bill.number} · ${bill.title}`}
                  subtitle={`${bill.latestAction} · ${bill.lastActionAt}`}
                  trailing={<Badge tone={BILL_STATUS_TONE[bill.status]}>{bill.chamber}</Badge>}
                />
              ))
            ) : (
              <p className="px-2 py-6 text-[13px] text-[var(--muted)]">
                Run the legislation sync to populate activity.
              </p>
            )}
          </CardBody>
          <CardFooter label="View all legislative activity" href="/bills" />
        </Card>

        <Card>
          <CardHeader
            title="Trending bills"
            icon={<Flame />}
            actionLabel="View all"
            actionHref="/bills"
          />
          <CardBody tight>
            {feed.trendingBills.length > 0 ? (
              feed.trendingBills.map((bill: Bill, index: number) => (
                <ListRow
                  key={bill.id}
                  href={billHref(bill.id)}
                  leading={<Rank>{index + 1}</Rank>}
                  title={`${bill.number} · ${bill.title}`}
                  subtitle={bill.sponsorName}
                  trailing={<Badge tone={BILL_STATUS_TONE[bill.status]}>{bill.status}</Badge>}
                />
              ))
            ) : (
              <p className="px-2 py-6 text-[13px] text-[var(--muted)]">
                No stored bills are available yet.
              </p>
            )}
          </CardBody>
          <CardFooter label="View all bills" href="/bills" />
        </Card>

        <Card>
          <CardHeader
            title="News pulse"
            icon={<Newspaper />}
            actionLabel="View all"
            actionHref="/news"
          />
          <CardBody tight>
            {feed.news.length > 0 ? (
              feed.news.map((item) => (
                <ListRow
                  key={item.id}
                  href="/news"
                  leading={
                    <IconTile tone="amber">
                      <Newspaper />
                    </IconTile>
                  }
                  title={item.headline}
                  subtitle={`${item.source} · ${item.publishedAt}`}
                />
              ))
            ) : (
              <p className="px-2 py-6 text-[13px] text-[var(--muted)]">
                No stored news items are available yet.
              </p>
            )}
          </CardBody>
          <CardFooter label="View all news" href="/news" />
        </Card>
      </div>

      <div className="grid gap-3.5 xl:grid-cols-3">
        <Card>
          <CardHeader title="Upcoming votes" icon={<CalendarClock />} />
          <CardBody tight>
            {feed.upcomingVotes.length > 0 ? (
              feed.upcomingVotes.map((vote) => (
                <ListRow
                  key={vote.id}
                  href={voteHref(vote.billId, vote.id)}
                  leading={
                    <IconTile tone="sky">
                      <Vote />
                    </IconTile>
                  }
                  title={`${vote.billNumber} · ${vote.title}`}
                  subtitle={`${vote.chamber} · ${vote.dateLabel}`}
                />
              ))
            ) : (
              <p className="px-2 py-6 text-[13px] text-[var(--muted)]">
                No floor items are available from the current dataset.
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Most active issues"
            icon={<Layers />}
            actionLabel="All issues"
            actionHref="/issues"
          />
          <CardBody>
            {rankedIssues.length > 0 ? (
              rankedIssues.map((issue) => (
                <Link key={issue.id} href={`/issues/${issue.slug}`} className="block">
                  <MeterRow
                    label={issue.name}
                    icon={<TopicIcon topic={issue.name} />}
                    value={issue.stats.activeBills}
                    max={issueMax}
                    display={issue.stats.activeBills}
                  />
                </Link>
              ))
            ) : (
              <p className="py-6 text-[13px] text-[var(--muted)]">
                No stored issues are available yet.
              </p>
            )}
          </CardBody>
          <CardFooter label="Explore all issues" href="/issues" />
        </Card>

        <Card>
          <CardHeader
            title="Your watchlist"
            icon={<Star />}
            actionLabel="Manage"
            actionHref="/watchlist"
          />
          <CardBody tight>
            <WatchlistPreview />
          </CardBody>
          <CardFooter label="Open watchlist" href="/watchlist" />
        </Card>
      </div>
    </div>
  );
}
