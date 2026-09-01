import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, Users } from "lucide-react";

import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
import { StatTile } from "@/components/ui/stat-tile";
import { partyTone } from "@/components/ui/tones";
import {
  getElectionRaceData,
  getElectionsSourceLabel,
  isLiveElectionsSource,
} from "@/lib/data/elections";

export const revalidate = 21600;

const STANDING_LABEL: Record<string, string> = {
  incumbent: "Incumbent",
  challenger: "Challenger",
  open: "Open-seat candidate",
  unknown: "Not stated",
};

function money(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export default async function ElectionRacePage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const { race, candidates, source, cycle, electionDate, daysRemaining } =
    await getElectionRaceData(raceId);

  if (!race) notFound();

  const electionDay = new Date(electionDate).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const parties = race.partiesContesting;
  // Money exists for sitting members only, so say how many rather than implying the rest are $0.
  const withMoney = candidates.filter((candidate) => typeof candidate.receipts === "number");

  return (
    <div className="space-y-6">
      <BackLink fallbackHref="/elections" label="All races" />

      <PageHeader
        eyebrow={`${cycle} · ${race.officeLabel}`}
        title={race.label}
        description={
          race.isOpenSeat
            ? "No incumbent has filed for this seat."
            : `${race.incumbent?.name} is defending this seat.`
        }
        actions={
          <SourceBadge
            label={getElectionsSourceLabel(source)}
            live={isLiveElectionsSource(source)}
          />
        }
      />

      <WithRail
        rail={
          <>
            <Card>
              <CardHeader title="Election day" icon={<CalendarClock />} />
              <CardBody>
                <p className="text-sm font-semibold">{electionDay}</p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  {daysRemaining === null
                    ? "This election has passed."
                    : `${daysRemaining.toLocaleString()} days away.`}
                </p>
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Reading this race" />
              <CardNote>
                Candidates are everyone on file with the FEC as a statutory candidate for this
                seat, before any primary has narrowed the field — so a long list is a crowded
                filing period, not a crowded ballot.
                {race.districtStated
                  ? ""
                  : " The FEC filing for this seat carried no district number."}
              </CardNote>
            </Card>
          </>
        }
      >
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatTile label="Candidates filed" value={candidates.length} />
          <StatTile label="Parties" value={parties.length} />
          <StatTile
            label="Seat"
            value={race.isOpenSeat ? "Open" : "Defended"}
            tone={race.isOpenSeat ? "amber" : "slate"}
          />
        </section>

        <Card>
          <CardHeader title="Candidates" icon={<Users />} count={candidates.length} />
          <div className="divide-y divide-[var(--line)]">
            {candidates.map((candidate) => {
              const receipts = money(candidate.receipts);
              return (
                <div
                  key={candidate.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3.5"
                >
                  <span className="font-medium">
                    {candidate.politicianSlug ? (
                      <Link
                        href={`/politicians/${candidate.politicianSlug}`}
                        className="text-[var(--accent-2)] hover:underline"
                      >
                        {candidate.name}
                      </Link>
                    ) : (
                      candidate.name
                    )}
                  </span>

                  <Badge tone={partyTone(candidate.party)}>{candidate.party}</Badge>

                  <span className="text-xs text-[var(--muted)]">
                    {STANDING_LABEL[candidate.standing]}
                  </span>

                  <span className="ml-auto text-xs">
                    {receipts ? (
                      <span className="num text-[var(--muted)]">{receipts} raised</span>
                    ) : (
                      /*
                       * Finance snapshots key on politician_id, which only sitting members have.
                       * A challenger with no snapshot has not been shown to have raised nothing --
                       * we simply do not hold the figure, and "$0" would be a false claim.
                       */
                      <span className="text-[var(--faint)]">No filing stored</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {withMoney.length < candidates.length ? (
            <CardNote>
              Fundraising is stored for sitting members only ({withMoney.length} of{" "}
              {candidates.length} here). A blank is a gap in Politica&apos;s data, not a candidate
              who raised nothing.
            </CardNote>
          ) : null}
        </Card>
      </WithRail>
    </div>
  );
}
