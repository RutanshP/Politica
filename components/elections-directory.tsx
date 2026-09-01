"use client";

import Link from "next/link";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Toolbar } from "@/components/ui/layout";
import { partyTone } from "@/components/ui/tones";
import type { ElectionRaceSummary } from "@/lib/data/elections";
import { raceHref } from "@/lib/elections";
import { normalizeStateLabel, sortLabelsAlphabetically } from "@/lib/utils";

const PAGE_SIZE = 25;
const ALL_CHAMBERS = "Both chambers";
const ALL_STATES = "All states";
const ANY_SEAT = "Any seat";
const OPEN_SEATS = "Open seats";
const DEFENDED = "Incumbent running";

export function ElectionsDirectory({ races }: { races: ElectionRaceSummary[] }) {
  const [query, setQuery] = useState("");
  const [chamber, setChamber] = useState(ALL_CHAMBERS);
  const [state, setState] = useState(ALL_STATES);
  const [seatStatus, setSeatStatus] = useState(ANY_SEAT);
  const [page, setPage] = useState(1);

  const states = useMemo(
    () => [ALL_STATES, ...sortLabelsAlphabetically(races.map((race) => normalizeStateLabel(race.stateCode)))],
    [races],
  );

  /*
   * Chambers come from the data rather than a fixed list. A midterm has no presidential race, so
   * offering "President" would be a filter that always returns nothing -- and in a presidential
   * year it appears on its own.
   */
  const chambers = useMemo(
    () => [ALL_CHAMBERS, ...sortLabelsAlphabetically(races.map((race) => race.officeLabel))],
    [races],
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return races.filter((race) => {
      const matchesQuery =
        normalizedQuery.length === 0
        || [race.label, race.stateLabel, race.seat, race.incumbentName]
          .filter(Boolean)
          .some((value) => (value as string).toLowerCase().includes(normalizedQuery));

      const matchesSeat =
        seatStatus === ANY_SEAT
        || (seatStatus === OPEN_SEATS ? race.isOpenSeat : !race.isOpenSeat);

      return (
        matchesQuery
        && matchesSeat
        && (chamber === ALL_CHAMBERS || race.officeLabel === chamber)
        && (state === ALL_STATES || race.stateLabel === state)
      );
    });
  }, [chamber, query, races, seatStatus, state]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /** Any filter change invalidates the current page offset. */
  function apply(change: () => void) {
    setPage(1);
    change();
  }

  return (
    <div className="space-y-4">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
        <input
          type="search"
          value={query}
          onChange={(event) => apply(() => setQuery(event.target.value))}
          placeholder="Search races by state, seat, or incumbent…"
          aria-label="Search races"
          className="h-10 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-3.5 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
        />
      </div>

      <FilterBar
        filters={[
          { label: "Chamber", value: chamber, options: chambers },
          { label: "State", value: state, options: states },
          { label: "Seat", value: seatStatus, options: [ANY_SEAT, OPEN_SEATS, DEFENDED] },
        ]}
        onChange={(label, value) =>
          apply(() => {
            if (label === "Chamber") setChamber(value);
            if (label === "State") setState(value);
            if (label === "Seat") setSeatStatus(value);
          })
        }
      />

      <Card>
        <Toolbar>
          <span className="text-[13px]">
            <b className="num">{filtered.length.toLocaleString()}</b>{" "}
            <span className="text-[var(--muted)]">
              {filtered.length === 1 ? "race" : "races"}
              {" · "}
              <b className="num">{filtered.filter((race) => race.isOpenSeat).length}</b> with no
              incumbent running
            </span>
          </span>
        </Toolbar>

        <DataTable
          emptyMessage="No races match these filters."
          columns={[
            "Seat",
            "Chamber",
            "Incumbent",
            { label: "Candidates", align: "right" },
            "Parties",
          ]}
          rows={pageRows.map((race) => [
            <Link
              key={race.id}
              href={raceHref(race.id)}
              className="font-semibold text-[var(--accent-2)] hover:underline"
            >
              {race.seat || race.stateLabel}
            </Link>,
            <Badge key={`${race.id}-ch`} tone="slate">
              {race.officeLabel}
            </Badge>,
            race.incumbentName ? (
              <span key={`${race.id}-inc`} className="flex items-center gap-2">
                <span>{race.incumbentName}</span>
                {race.incumbentParty ? (
                  <Badge tone={partyTone(race.incumbentParty)}>{race.incumbentParty}</Badge>
                ) : null}
              </span>
            ) : (
              // Not "none" -- the seat is open, which is the more useful reading.
              <span key={`${race.id}-inc`} className="text-xs text-[var(--faint)]">
                Open seat
              </span>
            ),
            <span key={`${race.id}-n`} className="num">
              {race.candidateCount}
            </span>,
            <span key={`${race.id}-parties`} className="text-[var(--muted)]">
              {race.partiesContesting.length}
            </span>,
          ])}
        />

        <Pagination
          page={currentPage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          onPageChange={setPage}
        />
      </Card>

      {races.length === 0 ? (
        <EmptyState
          title="No races loaded"
          description="The FEC candidate sync has not stored any filings for this cycle yet."
        />
      ) : null}
    </div>
  );
}
