import {
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gavel,
  Landmark,
  MapPin,
  Newspaper,
  Phone,
  Scale,
  Vote,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/empty-state";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { StatDonut } from "@/components/stat-donut";
import { WatchButton } from "@/components/watch-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge, Tag } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { IconTile } from "@/components/ui/icon-tile";
import { WithRail } from "@/components/ui/layout";
import { ListRow } from "@/components/ui/list-row";
import { MeterRow } from "@/components/ui/meter";
import { StatTile } from "@/components/ui/stat-tile";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { BILL_STATUS_TONE, partyTone } from "@/components/ui/tones";
import { getCommitteesData } from "@/lib/data/committees";
import { formatMoney } from "@/components/funding/funding-graph-theme";
import { getMemberReceipts } from "@/lib/data/money";
import { getNewsData } from "@/lib/data/news";
import {
  getCommitteeMembershipsForPolitician,
  getPoliticianData,
  getPoliticianSourceLabel,
  getSponsoredBillsForPolitician,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import { getStoredPoliticianTerms } from "@/lib/supabase/politicians";
import { buildTenure, buildTenureFromOfficialTerms, type OfficialTerm } from "@/lib/tenure";
import { billHref, hasVotePerformanceStats, realText } from "@/lib/utils";
import type { Bill, Committee, NewsItem } from "@/types/civic";

export const revalidate = 21600;

export default async function PoliticianProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const [sponsoredBills, committeesData, receipts, newsData, committeeMemberships, terms] =
    await Promise.all([
      getSponsoredBillsForPolitician(slug),
      getCommitteesData(),
      getMemberReceipts(politician.id),
      getNewsData(),
      getCommitteeMembershipsForPolitician(slug),
      getStoredPoliticianTerms(slug).catch(() => ({ official: [], congressRows: [] })),
    ]);

  const relatedCommittees = committeesData.committees.filter((committee: Committee) =>
    committeeMemberships.some((membership) => membership.committeeId === committee.id),
  );
  const relatedNews = newsData.news.filter(
    (item: NewsItem) =>
      item.relatedIds.includes(politician.id) || item.relatedIds.includes(politician.slug),
  );

  const hasVoteStats = hasVotePerformanceStats(politician.stats);
  const voteDonuts = [
    {
      label: "Votes with party",
      value: hasVoteStats ? politician.stats.votesWithParty : null,
      tone: "emerald" as const,
    },
    {
      label: "Votes against party",
      value: hasVoteStats ? politician.stats.votesAgainstParty : null,
      tone: "rose" as const,
    },
    {
      label: "Attendance",
      value: hasVoteStats ? politician.stats.attendance : null,
      tone: "sky" as const,
    },
  ];

  const ideology = Object.entries(politician.ideology);
  // From recorded terms, as the Tenure tab does; the stored field is a placeholder for everyone.
  const asOfYear = new Date().getUTCFullYear();
  const nextElectionYear = politician.jurisdictionType === "state"
    ? null
    : (terms.official.length > 0
      ? buildTenureFromOfficialTerms(terms.official as OfficialTerm[], asOfYear)
      : buildTenure(terms.congressRows, asOfYear)).nextElectionYear;
  const biographyFacts = ([
    ["Born", realText(politician.born)],
    ["Education", realText(politician.education)],
    ["Occupation", realText(politician.occupation)],
  ] as const).filter(([, value]) => value);

  const website = politician.website.startsWith("http")
    ? politician.website
    : `https://${politician.website}`;

  const watchItem = {
    id: politician.id,
    type: "politician" as const,
    label: politician.name,
    subtitle: `${politician.title} · ${politician.state}`,
    href: `/politicians/${politician.slug}`,
  };

  return (
    <div>
      <Link
        href="/politicians"
        className="mb-3.5 inline-flex items-center gap-1.5 text-[13px] text-[var(--muted)] transition hover:text-[var(--ink)]"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to politicians
      </Link>

      {/* Hero */}
      <div className="mb-3.5 flex flex-wrap items-start gap-5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-5">
        <Avatar
          name={politician.name}
          id={politician.id}
          party={politician.party}
          size="xl"
        />

        <div className="min-w-[260px] flex-1">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{politician.name}</h1>
          <p className="mt-0.5 text-[13.5px] text-[var(--muted)]">
            {politician.title}
            {politician.district ? ` · ${politician.district}` : ` · ${politician.state}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone={partyTone(politician.party)} dot>
              {politician.party}
            </Badge>
            <Tag>{politician.state}</Tag>
            {/* Derived from recorded terms above; the stored next_election is a placeholder. */}
            {nextElectionYear ? <Tag>Next election {nextElectionYear}</Tag> : null}
          </div>
        </div>

        <div className="flex flex-none flex-wrap gap-7">
          <div className="min-w-[140px]">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
              Committees
            </p>
            <p className="text-[13px] font-semibold">
              <span className="num">{relatedCommittees.length}</span>{" "}
              {relatedCommittees.length === 1 ? "assignment" : "assignments"}
            </p>
            {relatedCommittees[0] ? (
              <p className="line-clamp-1 text-xs text-[var(--muted)]">
                {relatedCommittees[0].name}
              </p>
            ) : null}
          </div>
          <div className="min-w-[140px]">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
              {receipts ? `Raised ${receipts.cycle - 1}–${String(receipts.cycle).slice(2)}` : "Fundraising"}
            </p>
            <p className="num text-[13px] font-semibold">
              {receipts ? formatMoney(receipts.receipts) || "$0" : "No FEC filing stored"}
            </p>
            <Link
              href={`/politicians/${politician.slug}/funding`}
              className="text-xs text-[var(--accent-2)] hover:underline"
            >
              Open funding graph →
            </Link>
          </div>
        </div>

        <div className="ml-auto flex flex-none items-center gap-2">
          <SourceBadge
            label={getPoliticianSourceLabel(source)}
            live={isLivePoliticianSource(source)}
          />
          <WatchButton item={watchItem} />
          <ButtonLink href={`/politicians/${politician.slug}/analytics`}>
            <BarChart3 />
            Analytics
          </ButtonLink>
        </div>
      </div>

      {/* Stat tiles */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Bills introduced"
          value={politician.stats.billsIntroduced.toLocaleString()}
          icon={<FileText />}
          tone="indigo"
          footnote="Sponsored legislation on record"
        />
        <StatTile
          label="Bills passed"
          value={politician.stats.billsPassed.toLocaleString()}
          icon={<CheckCircle2 />}
          tone="emerald"
          footnote="Cleared a chamber or became law"
        />
        <StatTile
          label="Amendments offered"
          value={politician.stats.amendmentsOffered.toLocaleString()}
          icon={<Gavel />}
          tone="amber"
          footnote="Floor and committee"
        />
        <StatTile
          label="Attendance"
          value={hasVoteStats ? politician.stats.attendance : "N/A"}
          suffix={hasVoteStats ? "%" : undefined}
          icon={<Vote />}
          tone="sky"
          footnote={
            politician.stats.totalVotes
              ? `of ${politician.stats.totalVotes.toLocaleString()} recorded votes`
              : "No recorded votes stored yet"
          }
        />
      </div>

      <PoliticianTabs
        slug={politician.slug}
        active="overview"
        title={politician.title}
        counts={{
          bills: sponsoredBills.length || undefined,
          votes: politician.stats.totalVotes || undefined,
        }}
      />

      <WithRail
        rail={
          <>
            {/*
              Only facts that are on file. Every member's education read "Not available from
              configured sources", every occupation "Public official", and most biographies
              "US Representative from Texas. Synced from Congress.gov..." -- placeholders that
              filled a card with nothing.
            */}
            {biographyFacts.length > 0 || realText(politician.biography) ? (
              <Card id="biography">
                <CardHeader title="Biography" />
                <CardBody>
                  {realText(politician.biography) ? (
                    <p className="mb-3.5 text-[13px] leading-relaxed text-[var(--muted)]">
                      {politician.biography}
                    </p>
                  ) : null}
                  <div className="flex flex-col gap-2.5">
                    {biographyFacts.map(([label, value]) => (
                      <div key={label}>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
                          {label}
                        </p>
                        <p className="text-[13px]">{value}</p>
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            ) : null}

            <Card>
              <CardHeader title="Contact" />
              <CardBody tight>
                {realText(politician.officeAddress) ? (
                  <ListRow
                    leading={
                      <IconTile tone="indigo">
                        <MapPin />
                      </IconTile>
                    }
                    title={politician.officeAddress}
                  />
                ) : null}
                {realText(politician.officePhone) ? (
                  <ListRow
                    leading={
                      <IconTile tone="indigo">
                        <Phone />
                      </IconTile>
                    }
                    title={<span className="num">{politician.officePhone}</span>}
                  />
                ) : null}
                {nextElectionYear ? (
                  <ListRow
                    href={`/politicians/${politician.slug}/tenure`}
                    leading={
                      <IconTile tone="indigo">
                        <CalendarDays />
                      </IconTile>
                    }
                    title="Next election"
                    subtitle={`November ${nextElectionYear}`}
                  />
                ) : null}
                {realText(politician.website) ? (
                  <ListRow
                    href={website}
                    leading={
                      <IconTile tone="indigo">
                        <Landmark />
                      </IconTile>
                    }
                    title="Official website"
                    subtitle={politician.website}
                  />
                ) : null}
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
                  relatedNews.slice(0, 4).map((item: NewsItem) => (
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
          <CardHeader title="Voting behavior" icon={<Vote />} />
          <CardBody>
            <div className="grid grid-cols-3 gap-3">
              {voteDonuts.map((donut) => (
                <StatDonut
                  key={donut.label}
                  value={donut.value}
                  label={donut.label}
                  tone={donut.tone}
                />
              ))}
            </div>
          </CardBody>
          {!hasVoteStats ? (
            <CardNote>
              No roll-call positions are stored for this member yet, so vote rates cannot be
              computed.
            </CardNote>
          ) : null}
        </Card>

        <div className="grid gap-3.5 lg:grid-cols-2">
          <Card id="bills">
            <CardHeader
              title="Sponsored bills"
              icon={<FileText />}
              actionLabel={sponsoredBills.length > 5 ? `View all ${sponsoredBills.length}` : undefined}
              actionHref={
                sponsoredBills.length > 5 ? `/politicians/${politician.slug}/bills` : undefined
              }
            />
            <CardBody tight>
              {sponsoredBills.length > 0 ? (
                sponsoredBills.slice(0, 5).map((bill: Bill) => (
                  <ListRow
                    key={bill.id}
                    href={billHref(bill.id)}
                    leading={
                      <IconTile tone={topicVisual(bill.topic).tone}>
                        <TopicIcon topic={bill.topic} />
                      </IconTile>
                    }
                    title={bill.number}
                    subtitle={bill.title}
                    trailing={
                      <Badge tone={BILL_STATUS_TONE[bill.status]}>{bill.status}</Badge>
                    }
                  />
                ))
              ) : (
                <div className="p-2">
                  <EmptyState
                    title="No sponsored bills in the current dataset"
                    description="This profile is connected, but the synced bill window does not yet include sponsored legislation for this member."
                    actionLabel="Open bills"
                    actionHref="/bills"
                  />
                </div>
              )}
            </CardBody>
          </Card>

          <Card id="committees">
            <CardHeader
              title="Committees"
              icon={<Building2 />}
              count={relatedCommittees.length || undefined}
            />
            <CardBody tight>
              {relatedCommittees.length > 0 ? (
                relatedCommittees.slice(0, 5).map((committee: Committee) => {
                  const membership = committeeMemberships.find(
                    (item) => item.committeeId === committee.id,
                  );
                  return (
                    <ListRow
                      key={committee.id}
                      href={`/committees/${committee.slug}`}
                      leading={
                        <IconTile tone="sky">
                          <Landmark />
                        </IconTile>
                      }
                      title={committee.name}
                      subtitle={`${membership?.role || "Member"} · ${committee.chamber}`}
                    />
                  );
                })
              ) : (
                <div className="p-2">
                  <EmptyState
                    title="No committee affiliations connected yet"
                    description="Committee memberships appear here as more detailed member data is synced."
                  />
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        {ideology.length > 0 ? (
          <Card>
            <CardHeader title="Issue positions" icon={<Scale />} />
            <CardBody>
              {ideology.map(([key, value]) => (
                <MeterRow key={key} label={key} value={value} display={value} fluid />
              ))}
            </CardBody>
            <CardNote>Derived from sponsorship and voting patterns in the stored dataset.</CardNote>
          </Card>
        ) : null}
      </WithRail>
    </div>
  );
}
