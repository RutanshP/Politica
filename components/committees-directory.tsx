"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
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
    <div className="space-y-6">
      <div className="rounded-[28px] border border-[var(--line)] bg-white p-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Search committees
        </label>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search committees by name, chamber, jurisdiction, or sector..."
          className="mt-3 w-full rounded-full border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
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

      <DataTable
        columns={["Committee", "Sector", "Chamber", "Jurisdiction", "Active bills", "Upcoming hearing"]}
        rows={pageRows.map((committee) => [
          <Link key={committee.id} href={`/committees/${committee.slug}`} className="font-semibold text-[var(--accent)]">
            {committee.name}
          </Link>,
          committee.sector,
          committee.chamber,
          committee.jurisdiction,
          committee.activeBillIds.length,
          committee.hearingLabel,
        ])}
      />

      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />
    </div>
  );
}
