"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { Card } from "@/components/ui/card";
import { Toolbar } from "@/components/ui/layout";
import { deriveCommitteeSector, normalizeCommitteeField, sortLabelsAlphabetically } from "@/lib/utils";
import type { Committee } from "@/types/civic";

const PAGE_SIZE = 20;

function getHearingStatus(committee: Committee) {
  return normalizeCommitteeField(committee.hearing, "No hearing scheduled") === "No hearing scheduled"
    ? "No hearing"
    : "Hearing scheduled";
}

export function CommitteesDirectory({
  committees,
}: {
  committees: Committee[];
}) {
  const committeeRows = useMemo(() => committees.map((committee) => ({
    ...committee,
    sector: deriveCommitteeSector(committee),
    hearingLabel: normalizeCommitteeField(committee.hearing, "No hearing scheduled"),
    hearingStatus: getHearingStatus(committee),
  })), [committees]);

  const chambers = useMemo(
    () => ["All chambers", ...sortLabelsAlphabetically(committeeRows.map((committee) => committee.chamber))],
    [committeeRows],
  );
  const jurisdictions = useMemo(
    () => ["All jurisdictions", ...sortLabelsAlphabetically(committeeRows.map((committee) => committee.jurisdiction))],
    [committeeRows],
  );
  const sectors = useMemo(
    () => ["All sectors", ...sortLabelsAlphabetically(committeeRows.map((committee) => committee.sector))],
    [committeeRows],
  );

  const [query, setQuery] = useState("");
  const [chamber, setChamber] = useState("All chambers");
  const [jurisdiction, setJurisdiction] = useState("All jurisdictions");
  const [sector, setSector] = useState("All sectors");
  const [hearingStatus, setHearingStatus] = useState("Any hearing status");
  const [sortBy, setSortBy] = useState("Name");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return committeeRows
      .filter((committee) => {
        const matchesQuery = normalizedQuery.length === 0 || [
          committee.name,
          committee.chamber,
          committee.jurisdiction,
          committee.sector,
        ].some((value) => value.toLowerCase().includes(normalizedQuery));

        return matchesQuery
          && (chamber === "All chambers" || committee.chamber === chamber)
          && (jurisdiction === "All jurisdictions" || committee.jurisdiction === jurisdiction)
          && (sector === "All sectors" || committee.sector === sector)
          && (hearingStatus === "Any hearing status" || committee.hearingStatus === hearingStatus);
      })
      .sort((left, right) => {
        if (sortBy === "Active bills") {
          return right.activeBillIds.length - left.activeBillIds.length;
        }
        if (sortBy === "Sector") {
          return left.sector.localeCompare(right.sector);
        }
        if (sortBy === "Jurisdiction") {
          return left.jurisdiction.localeCompare(right.jurisdiction);
        }

        return left.name.localeCompare(right.name);
      });
  }, [chamber, committeeRows, hearingStatus, jurisdiction, query, sector, sortBy]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search committees by name, chamber, jurisdiction, or sector…"
          aria-label="Search committees"
          className="h-10 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-3.5 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
        />
      </div>

      <FilterBar
        filters={[
          { label: "Chamber", value: chamber, options: chambers },
          { label: "Jurisdiction", value: jurisdiction, options: jurisdictions },
          { label: "Sector", value: sector, options: sectors },
          { label: "Hearings", value: hearingStatus, options: ["Any hearing status", "Hearing scheduled", "No hearing"] },
          { label: "Sort by", value: sortBy, options: ["Name", "Sector", "Jurisdiction", "Active bills"] },
        ]}
        onChange={(label, value) => {
          setPage(1);
          if (label === "Chamber") setChamber(value);
          if (label === "Jurisdiction") setJurisdiction(value);
          if (label === "Sector") setSector(value);
          if (label === "Hearings") setHearingStatus(value);
          if (label === "Sort by") setSortBy(value);
        }}
      />

      <Card>
        <Toolbar>
          <span className="text-[13px]">
            <b className="num">{filtered.length.toLocaleString()}</b>{" "}
            <span className="text-[var(--muted)]">
              {filtered.length === 1 ? "committee" : "committees"} · sorted by{" "}
              {sortBy.toLowerCase()}
            </span>
          </span>
        </Toolbar>

        <DataTable
          emptyMessage="No committees match these filters."
          columns={[
            "Committee",
            "Sector",
            "Chamber",
            "Jurisdiction",
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
            <span key={`${committee.id}-sector`} className="text-[var(--muted)]">
              {committee.sector}
            </span>,
            <span key={`${committee.id}-chamber`} className="text-[var(--muted)]">
              {committee.chamber}
            </span>,
            <span key={`${committee.id}-jur`} className="text-[var(--muted)]">
              {committee.jurisdiction}
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
    </div>
  );
}
