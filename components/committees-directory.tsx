"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Toolbar } from "@/components/ui/layout";
import { SortDirectionToggle } from "@/components/ui/sort-direction-toggle";
import {
  naturalSortDirection,
  sortDirectionFactor,
  sortDirectionLabel,
  type SortDirection,
} from "@/lib/sort-direction";
import {
  COMMITTEE_CHAMBER_UNSPECIFIED,
  deriveCommitteeSector,
  normalizeCommitteeField,
  normalizeStateLabel,
  sortLabelsAlphabetically,
} from "@/lib/utils";
import type { Committee } from "@/types/civic";

const PAGE_SIZE = 20;

const ALL_CHAMBERS = "All chambers";
const ALL_SECTORS = "All sectors";
const ANY_HEARING = "Any hearing status";
const SELECT_STATE = "Select a state";

function getHearingStatus(committee: Committee) {
  return normalizeCommitteeField(committee.hearing, "No hearing scheduled") === "No hearing scheduled"
    ? "No hearing"
    : "Hearing scheduled";
}

export function CommitteesDirectory({ committees }: { committees: Committee[] }) {
  const committeeRows = useMemo(
    () =>
      committees
        // A legislature chamber is not a committee; see Committee.isChamberRecord.
        .filter((committee) => !committee.isChamberRecord)
        .map((committee) => ({
          ...committee,
          level: committee.jurisdictionType === "state" ? "State" : "Federal",
          stateLabel: committee.state ? normalizeStateLabel(committee.state) : "",
          sector: deriveCommitteeSector(committee),
          hearingLabel: normalizeCommitteeField(committee.hearing, "No hearing scheduled"),
          hearingStatus: getHearingStatus(committee),
        })),
    [committees],
  );

  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("Federal");
  const [state, setState] = useState(SELECT_STATE);
  const [chamber, setChamber] = useState(ALL_CHAMBERS);
  const [sector, setSector] = useState(ALL_SECTORS);
  const [hearingStatus, setHearingStatus] = useState(ANY_HEARING);
  const [sortBy, setSortBy] = useState("Name");
  const [direction, setDirection] = useState<SortDirection>(() => naturalSortDirection("Name"));
  const [page, setPage] = useState(1);

  const isStateLevel = level === "State";
  /* Mirrors the politicians directory: State is not a browsable set on its own, you pick one. */
  const needsState = isStateLevel && state === SELECT_STATE;

  const states = useMemo(
    () => [
      SELECT_STATE,
      ...sortLabelsAlphabetically(
        committeeRows.filter((row) => row.level === "State").map((row) => row.stateLabel),
      ),
    ],
    [committeeRows],
  );

  /*
   * State committees went with the rest of the state data (SQL 027), so the level is offered only
   * when some are actually stored -- otherwise picking it emptied the table with no way to tell
   * that from a filter that had simply matched nothing.
   */
  const levels = useMemo(
    () => (committeeRows.some((row) => row.level === "State") ? ["Federal", "State"] : ["Federal"]),
    [committeeRows],
  );

  /* Everything the level (and state) selection admits -- the source for the remaining dropdowns. */
  const inScope = useMemo(
    () =>
      committeeRows.filter(
        (row) =>
          row.level === level && (!isStateLevel || needsState || row.stateLabel === state),
      ),
    [committeeRows, isStateLevel, level, needsState, state],
  );

  const chambers = useMemo(
    () => [ALL_CHAMBERS, ...sortLabelsAlphabetically(inScope.map((row) => row.chamber))],
    [inScope],
  );
  const sectors = useMemo(
    () => [ALL_SECTORS, ...sortLabelsAlphabetically(inScope.map((row) => row.sector))],
    [inScope],
  );

  const filtered = useMemo(() => {
    if (needsState) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return inScope
      .filter((committee) => {
        const matchesQuery =
          normalizedQuery.length === 0
          || [committee.name, committee.chamber, committee.stateLabel, committee.sector]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedQuery));

        return (
          matchesQuery
          && (chamber === ALL_CHAMBERS || committee.chamber === chamber)
          && (sector === ALL_SECTORS || committee.sector === sector)
          && (hearingStatus === ANY_HEARING || committee.hearingStatus === hearingStatus)
        );
      })
      // Natural order per option; the factor reverses it when the reader has flipped direction.
      .sort((left, right) => {
        const factor = sortDirectionFactor(sortBy, direction);
        if (sortBy === "Active bills") return factor * (right.activeBillIds.length - left.activeBillIds.length);
        if (sortBy === "Members") return factor * (right.memberIds.length - left.memberIds.length);
        if (sortBy === "Sector") return factor * left.sector.localeCompare(right.sector);
        if (sortBy === "Chamber") return factor * left.chamber.localeCompare(right.chamber);
        return factor * left.name.localeCompare(right.name);
      });
  }, [chamber, direction, hearingStatus, inScope, needsState, query, sector, sortBy]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  /** Any filter change invalidates the current page offset. */
  function apply(change: () => void) {
    setPage(1);
    change();
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
        <input
          type="search"
          value={query}
          onChange={(event) => apply(() => setQuery(event.target.value))}
          placeholder="Search committees by name, chamber, state, or sector…"
          aria-label="Search committees"
          className="h-10 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-3.5 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
        />
      </div>

      <FilterBar
        filters={[
          { label: "Level", value: level, options: levels },
          ...(isStateLevel ? [{ label: "State", value: state, options: states }] : []),
          { label: "Chamber", value: chamber, options: chambers },
          { label: "Sector", value: sector, options: sectors },
          {
            label: "Hearings",
            value: hearingStatus,
            options: [ANY_HEARING, "Hearing scheduled", "No hearing"],
          },
          {
            label: "Sort by",
            value: sortBy,
            options: ["Name", "Chamber", "Sector", "Active bills", "Members"],
          },
        ]}
        onChange={(label, value) =>
          apply(() => {
            if (label === "Level") {
              // Chamber and sector options differ per level, so reset them with the switch.
              setLevel(value);
              setState(SELECT_STATE);
              setChamber(ALL_CHAMBERS);
              setSector(ALL_SECTORS);
              return;
            }
            if (label === "State") {
              setState(value);
              setChamber(ALL_CHAMBERS);
              setSector(ALL_SECTORS);
              return;
            }
            if (label === "Chamber") setChamber(value);
            if (label === "Sector") setSector(value);
            if (label === "Hearings") setHearingStatus(value);
            if (label === "Sort by") {
              // A new sort option starts from its own natural order rather than inheriting a
              // flip that was meant for the previous one.
              setSortBy(value);
              setDirection(naturalSortDirection(value));
            }
          })
        }
      >
        <SortDirectionToggle
          sortBy={sortBy}
          direction={direction}
          onChange={(next) => apply(() => setDirection(next))}
        />
      </FilterBar>

      {needsState ? (
        <EmptyState
          title="Choose a state"
          description="Pick a state above to load its committees. State committees are browsed one state at a time rather than all at once."
        />
      ) : (
        <Card>
          <Toolbar>
            <span className="text-[13px]">
              <b className="num">{filtered.length.toLocaleString()}</b>{" "}
              <span className="text-[var(--muted)]">
                {filtered.length === 1 ? "committee" : "committees"} · sorted by{" "}
                {sortBy.toLowerCase()}, {sortDirectionLabel(sortBy, direction).toLowerCase()}
              </span>
            </span>
          </Toolbar>

          <DataTable
            emptyMessage="No committees match these filters."
            columns={[
              "Committee",
              "Chamber",
              isStateLevel ? "State" : "Jurisdiction",
              "Sector",
              { label: "Members", align: "right" },
              { label: "Active bills", align: "right" },
              "Upcoming hearing",
            ]}
            rows={pageRows.map((committee) => [
              <Link
                key={committee.id}
                href={`/committees/${committee.slug}`}
                className="font-semibold text-[var(--accent-2)] hover:underline"
              >
                {committee.name}
              </Link>,
              committee.chamber === COMMITTEE_CHAMBER_UNSPECIFIED ? (
                <span key={`${committee.id}-ch`} className="text-xs text-[var(--faint)]">
                  {COMMITTEE_CHAMBER_UNSPECIFIED}
                </span>
              ) : (
                <Badge key={`${committee.id}-ch`} tone="slate">
                  {committee.chamber}
                </Badge>
              ),
              <span key={`${committee.id}-where`} className="text-[var(--muted)]">
                {isStateLevel ? committee.stateLabel : committee.jurisdiction}
              </span>,
              <span key={`${committee.id}-sector`} className="text-[var(--muted)]">
                {committee.sector}
              </span>,
              <span key={`${committee.id}-members`} className="num">
                {committee.memberIds.length}
              </span>,
              <span key={`${committee.id}-bills`} className="num">
                {committee.activeBillIds.length}
              </span>,
              <span key={`${committee.id}-hearing`} className="text-[var(--muted)]">
                {committee.hearingLabel}
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
      )}
    </div>
  );
}
