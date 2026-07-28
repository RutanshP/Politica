import { notFound } from "next/navigation";
import { CalendarClock, Landmark, History, Vote } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { PoliticianTabs } from "@/components/politician-tabs";
import { SourceBadge } from "@/components/source-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import {
  getPoliticianData,
  getPoliticianSourceLabel,
  isLivePoliticianSource,
} from "@/lib/data/politicians";
import {
  hasStoredElectionCandidatesForCycle,
  listStoredElectionCandidatesByPoliticianId,
} from "@/lib/supabase/elections";
import { getStoredPoliticianTerms } from "@/lib/supabase/politicians";
import {
  buildTenure,
  describeReelectionFiling,
  type ReelectionFilingStatus,
  type TenureTerm,
} from "@/lib/tenure";

export const revalidate = 21600;

function ordinal(value: number) {
  const remainderTen = value % 10;
  const remainderHundred = value % 100;
  if (remainderTen === 1 && remainderHundred !== 11) return `${value}st`;
  if (remainderTen === 2 && remainderHundred !== 12) return `${value}nd`;
  if (remainderTen === 3 && remainderHundred !== 13) return `${value}rd`;
  return `${value}th`;
}

/** A Senate term spans three Congresses, so the column shows the range it covers. */
function congressRange(term: TenureTerm) {
  const first = term.congresses[0];
  const last = term.congresses[term.congresses.length - 1];
  if (first === undefined || last === undefined) return "—";
  return first === last ? ordinal(first) : `${ordinal(first)}–${ordinal(last)}`;
}

function seatLabel(term: TenureTerm) {
  if (term.chamber === "Senate") return `${term.stateCode ?? ""} Senate`.trim();
  return term.district === null
    ? `${term.stateCode ?? ""} at-large`.trim()
    : `${term.stateCode ?? ""}-${term.district}`;
}

export default async function PoliticianTenurePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { politician, source } = await getPoliticianData(slug);
  if (!politician) notFound();

  const [rawTerms, filings] = await Promise.all([
    getStoredPoliticianTerms(slug).catch(() => []),
    listStoredElectionCandidatesByPoliticianId(politician.id).catch(() => []),
  ]);

  const asOfYear = new Date().getUTCFullYear();
  const tenure = buildTenure(rawTerms, asOfYear);

  /*
   * "Has this member filed to run again?" is only answerable for a cycle the FEC sync has
   * actually loaded. A senator next up in 2030 has no 2030 rows to be absent from, and reading
   * that emptiness as "not running" would invent a retirement out of missing data -- so coverage
   * is checked before absence is allowed to mean anything.
   */
  const nextCycle = tenure.nextElectionYear;
  const cycleIsCovered = nextCycle && politician.jurisdictionType !== "state"
    ? await hasStoredElectionCandidatesForCycle(nextCycle).catch(() => false)
    : false;
  const filingForNextCycle = nextCycle
    ? filings.find((filing) => filing.cycle === nextCycle)
    : undefined;
  const filingStatus: ReelectionFilingStatus = !cycleIsCovered
    ? "unknown"
    : !filingForNextCycle
      ? "not-filed"
      : filingForNextCycle.candidate_inactive
        ? "inactive"
        : "filed";
  const filing = describeReelectionFiling(filingStatus, nextCycle);

  const totalTerms = tenure.terms.length;
  const orderedTerms = [...tenure.terms].reverse();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tenure"
        title={politician.name}
        description="Terms served, when the current term ends, and when this seat is next on the ballot."
        actions={
          <SourceBadge label={getPoliticianSourceLabel(source)} live={isLivePoliticianSource(source)} />
        }
      />
      <PoliticianTabs slug={politician.slug} active="tenure" />

      {totalTerms === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-[var(--muted)]">
              No term history has been synced for this member yet. Congress.gov publishes a term
              record for federal members; state legislators are not covered by that feed.
            </p>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              label="Terms served"
              value={totalTerms}
              icon={<History />}
              tone="indigo"
              footnote={
                tenure.switchedChambers
                  ? `${tenure.termsByChamber.House} House · ${tenure.termsByChamber.Senate} Senate`
                  : tenure.firstSwornYear
                    ? `Since ${tenure.firstSwornYear}`
                    : undefined
              }
            />
            <StatTile
              label="Years in office"
              value={tenure.yearsServed}
              icon={<Landmark />}
              tone="sky"
              footnote={tenure.currentTerm ? "Counting the term in progress" : "Service concluded"}
            />
            <StatTile
              label="Term ends"
              value={tenure.termEndsYear ?? "—"}
              icon={<CalendarClock />}
              tone="amber"
              footnote={tenure.termEndsYear ? `January ${tenure.termEndsYear}` : "No term in progress"}
            />
            <StatTile
              label="Next election"
              value={tenure.nextElectionYear ?? "—"}
              icon={<Vote />}
              tone="emerald"
              footnote={tenure.nextElectionYear ? `November ${tenure.nextElectionYear}` : undefined}
            />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
            <Card>
              <CardHeader title="Term history" icon={<History />} count={totalTerms} />
              <CardBody flush>
                <div className="w-full overflow-x-auto">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        {["Congress", "Chamber", "Seat", "Years"].map((column) => (
                          <th
                            key={column}
                            scope="col"
                            className="whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {orderedTerms.map((term) => (
                        <tr
                          key={`${term.chamber}-${term.startYear}-${term.congresses[0]}`}
                          className="border-b border-[var(--line)] transition last:border-b-0 hover:bg-white/2"
                        >
                          <td className="whitespace-nowrap px-3.5 py-2.5 align-top num text-[var(--ink)]">
                            {congressRange(term)}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 align-top">
                            <Badge tone={term.chamber === "Senate" ? "indigo" : "sky"}>
                              {term.chamber}
                            </Badge>
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 align-top text-[var(--muted)]">
                            {seatLabel(term)}
                          </td>
                          <td className="whitespace-nowrap px-3.5 py-2.5 align-top num text-[var(--muted)]">
                            {term.startYear}–{term.endYear ?? "present"}
                            {term.isCurrent ? (
                              <span className="ml-2 text-[11px] font-semibold text-[var(--success)]">
                                Current
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardBody>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader title="Running again?" icon={<Vote />} />
                <CardBody>
                  <Badge tone={filing.tone}>{filing.label}</Badge>
                  <p className="mt-3 text-[13px] leading-relaxed text-[var(--muted)]">
                    {filing.detail}
                  </p>
                  {filingForNextCycle?.party_full ? (
                    <p className="mt-2 text-xs text-[var(--faint)]">
                      Filed as {filingForNextCycle.party_full}
                      {filingForNextCycle.incumbent_challenge_full
                        ? ` · ${filingForNextCycle.incumbent_challenge_full}`
                        : ""}
                    </p>
                  ) : null}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Previous elections"
                  icon={<CalendarClock />}
                  count={tenure.previousElectionYears.length}
                />
                <CardBody>
                  {tenure.previousElectionYears.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {tenure.previousElectionYears.map((year) => (
                        <span
                          key={year}
                          className="num rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1 text-xs text-[var(--muted)]"
                        >
                          {year}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--muted)]">
                      No completed terms yet — this is the member&apos;s first.
                    </p>
                  )}
                  <CardNote>
                    Inferred from when each term began, so a seat filled by appointment appears
                    here as a seated year rather than a certified win.
                  </CardNote>
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
