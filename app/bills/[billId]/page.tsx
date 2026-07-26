import {
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock,
  FileText,
  Landmark,
  Layers,
  Newspaper,
  Share2,
  Users,
  Vote as VoteIcon,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BackLink } from "@/components/back-link";
import { BillProgressStepper } from "@/components/bill-progress";
import { BillTabs } from "@/components/bill-tabs";
import { SourceBadge } from "@/components/source-badge";
import { VoteArc } from "@/components/vote-arc";
import { WatchButton } from "@/components/watch-button";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { WithRail } from "@/components/ui/layout";
import { ListRow } from "@/components/ui/list-row";
import { Meter } from "@/components/ui/meter";
import { StatTile } from "@/components/ui/stat-tile";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { BILL_STATUS_TONE, TONE_COLOR } from "@/components/ui/tones";
import {
  getBillData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { getNewsData } from "@/lib/data/news";
import { getVotesDataForBill } from "@/lib/data/votes";
import { listStoredBillsByIds } from "@/lib/supabase/bills";
import { getStoredCommitteeById } from "@/lib/supabase/committees";
import { getStoredPoliticianById } from "@/lib/supabase/politicians";
import { isSubstantiveVote } from "@/lib/vote-classification";
import { formatSummaryText } from "@/lib/utils";

export const revalidate = 21600;

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ billId: string }>;
}) {
  const { billId } = await params;
  const [{ bill, source }, { news }, { votes }] = await Promise.all([
    getBillData(billId),
    getNewsData(),
    getVotesDataForBill(billId).catch(() => ({ votes: [] })),
  ]);

  if (!bill) notFound();
  const live = isLiveBillsSource(source);
  const [sponsor, committee, relatedBills] = await Promise.all([
    bill.sponsorId ? getStoredPoliticianById(bill.sponsorId).catch(() => undefined) : undefined,
    bill.committeeId ? getStoredCommitteeById(bill.committeeId).catch(() => undefined) : undefined,
    listStoredBillsByIds(bill.relatedBillIds).catch(() => []),
  ]);
  const relatedNews = news.filter((item) => item.relatedIds.includes(bill.id));

  // Prefer the substantive roll call (passage/amendment) over whatever procedural motion is first.
  const headlineVote =
    votes.find((item) => isSubstantiveVote(item.category ?? "policy")) || votes[0];

  const introducedMs = Date.parse(bill.introducedAt);
  // This page is cached for `revalidate` seconds, so "days active" is a snapshot that can lag by
  // up to that window -- acceptable at day granularity, which is why the impure Date.now() is fine.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const daysActive = Number.isFinite(introducedMs)
    ? Math.max(0, Math.round((nowMs - introducedMs) / 86_400_000))
    : null;

  const { tone: topicTone } = topicVisual(bill.topic);
  const summary = formatSummaryText(bill.summary);

  const watchItem = {
    id: bill.id,
    type: "bill" as const,
    label: `${bill.number} · ${bill.title}`,
    subtitle: bill.committeeName,
    href: `/bills/${bill.id}`,
  };

  return (
    <div>
      <BackLink fallbackHref="/bills" label="Back to bills" />

      {/* Hero */}
      <div className="mb-3.5 flex flex-wrap items-start gap-5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-5">
        <IconTile tone={topicTone} size="xl">
          <TopicIcon topic={bill.topic} />
        </IconTile>

        <div className="min-w-[280px] flex-1">
          <p
            className="mb-1.5 flex items-center gap-2 text-xs font-semibold"
            style={{ color: TONE_COLOR[BILL_STATUS_TONE[bill.status]] }}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {bill.status}
          </p>
          <h1 className="text-[30px] font-semibold tracking-[-0.02em]">{bill.number}</h1>
          {/* Long-form federal titles get three lines here rather than pushing the hero off-screen. */}
          <p className="mt-0.5 line-clamp-3 text-[17px] leading-snug text-[var(--ink)]">
            {bill.title}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Tag>{bill.session}</Tag>
            <Tag>{bill.chamber}</Tag>
            <Tag>{bill.jurisdiction}</Tag>
            <Tag>Introduced {bill.introducedAt}</Tag>
          </div>
        </div>

        <div className="flex flex-none flex-wrap gap-7">
          <div className="min-w-[150px]">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
              Sponsor
            </p>
            <div className="flex items-center gap-2.5">
              <Avatar
                name={bill.sponsorName}
                id={sponsor?.id ?? bill.sponsorId}
                party={sponsor?.party}
              />
              <span className="min-w-0">
                {sponsor ? (
                  <Link
                    href={`/politicians/${sponsor.slug}`}
                    className="block text-[13px] font-semibold text-[var(--accent-2)] hover:underline"
                  >
                    {bill.sponsorName}
                  </Link>
                ) : (
                  <span className="block text-[13px] font-semibold">{bill.sponsorName}</span>
                )}
                {sponsor ? (
                  <span className="block text-xs text-[var(--muted)]">
                    {sponsor.party} · {sponsor.state}
                  </span>
                ) : null}
              </span>
            </div>
          </div>

          <div className="min-w-[150px]">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
              Committee
            </p>
            {committee ? (
              <Link
                href={`/committees/${committee.slug}`}
                className="text-[13px] font-semibold text-[var(--accent-2)] hover:underline"
              >
                {bill.committeeName}
              </Link>
            ) : (
              <p className="text-[13px] font-semibold">{bill.committeeName}</p>
            )}
          </div>

          <div className="min-w-[150px]">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
              Last action
            </p>
            <p className="text-[13px] font-semibold">{bill.latestAction}</p>
            <p className="num text-xs text-[var(--muted)]">{bill.lastActionAt}</p>
          </div>
        </div>

        <div className="ml-auto flex flex-none items-center gap-2">
          <SourceBadge label={getBillsSourceLabel(source)} live={live} />
          <WatchButton item={watchItem} />
          <ButtonLink href={`/bills/${bill.id}/text`}>
            <Share2 />
            Text
          </ButtonLink>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <StatTile
          label="Bill status"
          value={<span className="text-[17px]">{bill.status}</span>}
          icon={<CheckCircle2 />}
          tone={BILL_STATUS_TONE[bill.status]}
          footnote={`${bill.latestAction} · ${bill.lastActionAt}`}
        />
        <StatTile
          label="Days active"
          value={daysActive ?? "—"}
          icon={<Clock />}
          tone="sky"
          footnote={`Introduced ${bill.introducedAt}`}
        />
        <StatTile
          label="Cosponsors"
          value={bill.stats.cosponsors.toLocaleString()}
          icon={<Users />}
          tone="indigo"
          footnote={`${bill.stats.bipartisanScore}% bipartisan score`}
        />
        <StatTile
          label="Amendments"
          value={bill.stats.amendments.toLocaleString()}
          icon={<Layers />}
          tone="amber"
          footnote="Offered against this measure"
        />
        <StatTile
          label="Recorded votes"
          value={votes.length.toLocaleString()}
          icon={<VoteIcon />}
          tone="emerald"
          footnote={headlineVote ? headlineVote.result : "No roll calls stored"}
        />
      </div>

      <BillTabs
        billId={bill.id}
        active="overview"
        counts={{
          timeline: bill.actions.length || undefined,
          text: bill.versions.length || undefined,
          votes: votes.length || undefined,
        }}
      />

      <WithRail
        rail={
          <>
            <Card>
              <CardHeader title="About this bill" icon={<FileText />} />
              <CardBody>
                <p className="whitespace-pre-line text-[13px] leading-relaxed text-[var(--muted)]">
                  {summary || "No stored summary is available for this bill."}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Chance of passing" />
              <CardBody>
                <div className="flex items-baseline gap-1.5">
                  <span className="num text-[34px] font-semibold tracking-[-0.02em]">
                    {bill.chanceOfPassing}
                  </span>
                  <span className="text-[var(--muted)]">%</span>
                </div>
                <Meter
                  value={bill.chanceOfPassing}
                  className="mt-3 h-1.5"
                  fill="linear-gradient(90deg, var(--accent), var(--success))"
                />
              </CardBody>
              <CardNote>
                Derived from cosponsor count, committee traction, and bipartisan activity.
              </CardNote>
            </Card>

            <Card id="related">
              <CardHeader title="Related bills" count={relatedBills.length || undefined} />
              <CardBody tight>
                {relatedBills.length > 0 ? (
                  relatedBills.map((related) => (
                    <ListRow
                      key={related.id}
                      href={`/bills/${related.id}`}
                      leading={
                        <IconTile tone={topicVisual(related.topic).tone}>
                          <TopicIcon topic={related.topic} />
                        </IconTile>
                      }
                      title={related.number}
                      subtitle={related.title}
                    />
                  ))
                ) : (
                  <p className="px-2 py-5 text-[13px] text-[var(--muted)]">
                    No related bills were identified in the current dataset.
                  </p>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader
                title="Related news"
                icon={<Newspaper />}
                count={relatedNews.length || undefined}
              />
              <CardBody tight>
                {relatedNews.length > 0 ? (
                  relatedNews.slice(0, 4).map((item) => (
                    <ListRow
                      key={item.id}
                      href="/news"
                      title={item.headline}
                      subtitle={`${item.source} · ${item.publishedAt}`}
                    />
                  ))
                ) : (
                  <p className="px-2 py-5 text-[13px] text-[var(--muted)]">
                    No connected news items yet.
                  </p>
                )}
              </CardBody>
            </Card>
          </>
        }
      >
        <Card>
          <CardHeader
            title="Legislative timeline"
            icon={<CalendarDays />}
            actionLabel="Full timeline"
            actionHref={`/bills/${bill.id}/timeline`}
          />
          <CardBody className="pb-5">
            <BillProgressStepper bill={bill} />
          </CardBody>
        </Card>

        <div className="grid gap-3.5 lg:grid-cols-2">
          {headlineVote ? (
            <Card>
              <CardHeader title={`Votes in ${headlineVote.chamber}`} icon={<VoteIcon />}>
                <Badge tone={/pass|agree/i.test(headlineVote.result) ? "emerald" : "rose"}>
                  {headlineVote.result}
                </Badge>
              </CardHeader>
              <CardBody>
                <VoteArc vote={headlineVote} />
              </CardBody>
              <CardNote>
                {headlineVote.title} · {headlineVote.dateLabel}
              </CardNote>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Recent actions"
              icon={<Clock />}
              actionLabel="View all"
              actionHref={`/bills/${bill.id}/timeline`}
            />
            <CardBody tight>
              {bill.actions.length > 0 ? (
                bill.actions.slice(0, 5).map((action, index) => (
                  <ListRow
                    key={`${action.date}-${index}`}
                    leading={
                      <IconTile tone={action.type === "milestone" ? "emerald" : "sky"}>
                        <CheckCircle2 />
                      </IconTile>
                    }
                    title={action.label}
                    subtitle={action.detail}
                    trailing={
                      <span className="num text-[11.5px] text-[var(--faint)]">{action.date}</span>
                    }
                  />
                ))
              ) : (
                <p className="px-2 py-5 text-[13px] text-[var(--muted)]">
                  No stored actions for this bill.
                </p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid gap-3.5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Related entities" icon={<Building2 />} />
            <CardBody tight>
              {sponsor ? (
                <ListRow
                  href={`/politicians/${sponsor.slug}`}
                  leading={<Avatar name={sponsor.name} id={sponsor.id} party={sponsor.party} />}
                  title={sponsor.name}
                  subtitle={`Sponsor · ${sponsor.title}`}
                />
              ) : null}
              {committee ? (
                <ListRow
                  href={`/committees/${committee.slug}`}
                  leading={
                    <IconTile tone="sky">
                      <Landmark />
                    </IconTile>
                  }
                  title={committee.name}
                  subtitle={`Primary committee · ${committee.chamber}`}
                />
              ) : null}
              {!sponsor && !committee ? (
                <p className="px-2 py-5 text-[13px] text-[var(--muted)]">
                  No connected entities were resolved for this bill.
                </p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Issue tags" icon={<Layers />} />
            <CardBody>
              <div className="flex flex-wrap gap-1.5">
                <Tag>{bill.topic}</Tag>
                <Tag>{bill.jurisdiction}</Tag>
                <Tag>{bill.chamber}</Tag>
                <Tag>{bill.session}</Tag>
              </div>
            </CardBody>
          </Card>
        </div>
      </WithRail>
    </div>
  );
}
