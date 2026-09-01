import { CalendarClock } from "lucide-react";

import { ElectionsDirectory } from "@/components/elections-directory";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
import { StatTile } from "@/components/ui/stat-tile";
import {
  getElectionsData,
  getElectionsSourceLabel,
  isLiveElectionsSource,
} from "@/lib/data/elections";

export const revalidate = 21600;

export const metadata = {
  title: "Elections",
  description: "Federal races on the ballot this cycle, from stored FEC candidate filings.",
};

export default async function ElectionsPage() {
  const { races, source, cycle, electionDate, daysRemaining, freshness } =
    await getElectionsData();

  const senate = races.filter((race) => race.office === "S");
  const house = races.filter((race) => race.office === "H");
  const openSeats = races.filter((race) => race.isOpenSeat);
  const electionDay = new Date(electionDate).toLocaleDateString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Elections"
        title={`${cycle} federal races`}
        description="Every U.S. House and Senate seat with candidates on file for this cycle, drawn from FEC filings. Federal offices only — state legislatures and governorships are not covered."
        actions={
          <SourceBadge
            label={getElectionsSourceLabel(source)}
            live={isLiveElectionsSource(source)}
          />
        }
      />

      {races.length === 0 ? (
        <EmptyState
          title="No races available"
          description="No FEC candidate filings are stored for this cycle yet. The candidate sync runs weekly; check the pipeline health page if this persists."
          actionLabel="Open politicians"
          actionHref="/politicians"
        />
      ) : (
        <WithRail
          rail={
            <>
              <Card>
                <CardHeader title="Election day" icon={<CalendarClock />} />
                <CardBody>
                  <p className="text-sm font-semibold">{electionDay}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {daysRemaining === null
                      ? "This election has passed; filings shown are for the cycle as stored."
                      : `${daysRemaining.toLocaleString()} days away.`}
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="About this data" />
                <CardNote>
                  Candidates are FEC filings, not a certified ballot: they include everyone who
                  has filed as a statutory candidate, before any primary has narrowed the field.
                  Withdrawn and not-yet-qualified filings are excluded.
                  {freshness?.stale ? " The latest sync is older than expected." : ""}
                </CardNote>
              </Card>
            </>
          }
        >
          <div className="space-y-4">
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Races" value={races.length} />
              <StatTile label="Senate seats" value={senate.length} />
              <StatTile label="House seats" value={house.length} />
              <StatTile
                label="Open seats"
                value={openSeats.length}
                footnote="No incumbent has filed"
              />
            </section>

            <ElectionsDirectory races={races} />
          </div>
        </WithRail>
      )}
    </div>
  );
}
