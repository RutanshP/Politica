"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { WatchButton } from "@/components/watch-button";
import { hasVotePerformanceStats, sortLabelsAlphabetically } from "@/lib/utils";
import type { Politician } from "@/types/civic";

const PAGE_SIZE = 20;

function getOfficeBucket(politician: Politician) {
  if (politician.jurisdictionType === "federal") {
    if (politician.title === "US Senator") return "US Senate";
    if (politician.title === "US Representative") return "US House";
    return "Other federal";
  }

  if (politician.title.includes("Senator")) return "State Senate";
  if (politician.title.includes("Representative")) return "State House";
  return "Other state";
}

export function PoliticiansDirectory({
  politicians,
}: {
  politicians: Politician[];
}) {
  const offices = useMemo(
    () => {
      const present = new Set(politicians.map(getOfficeBucket));
      return [
        "All chambers",
        "US House",
        "US Senate",
        ...(present.has("State House") ? ["State House"] : []),
        ...(present.has("State Senate") ? ["State Senate"] : []),
        ...(present.has("Other state") ? ["Other state"] : []),
      ];
    },
    [politicians],
  );
  const levels = useMemo(
    () => ["All levels", ...sortLabelsAlphabetically(
      politicians.map((politician) => politician.jurisdictionType === "state" ? "State" : "Federal"),
    )],
    [politicians],
  );
  const parties = useMemo(
    () => ["All parties", ...sortLabelsAlphabetically(politicians.map((politician) => politician.party))],
    [politicians],
  );
  const states = useMemo(
    () => ["All states", ...sortLabelsAlphabetically(politicians.map((politician) => politician.state))],
    [politicians],
  );

  const [query, setQuery] = useState("");
  const [office, setOffice] = useState("All chambers");
  const [level, setLevel] = useState("All levels");
  const [party, setParty] = useState("All parties");
  const [state, setState] = useState("All states");
  const [sortBy, setSortBy] = useState("Name");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const next = politicians
      .filter((politician) => {
        const matchesQuery =
          normalizedQuery.length === 0
          || [
            politician.name,
            politician.title,
            politician.party,
            politician.state,
          ].some((value) => value.toLowerCase().includes(normalizedQuery));
        const politicianOffice = getOfficeBucket(politician);
        const politicianLevel = politician.jurisdictionType === "state" ? "State" : "Federal";
        const matchesOffice = office === "All chambers" || politicianOffice === office;
        const matchesLevel = level === "All levels" || politicianLevel === level;
        const matchesParty = party === "All parties" || politician.party === party;
        const matchesState = state === "All states" || politician.state === state;

        return matchesQuery && matchesOffice && matchesLevel && matchesParty && matchesState;
      })
      .sort((left, right) => {
        if (sortBy === "Attendance") return right.stats.attendance - left.stats.attendance;
        if (sortBy === "Bills introduced") {
          return right.stats.billsIntroduced - left.stats.billsIntroduced;
        }
        if (sortBy === "Party alignment") {
          return right.stats.votesWithParty - left.stats.votesWithParty;
        }
        if (sortBy === "Recent activity") {
          return right.stats.amendmentsOffered - left.stats.amendmentsOffered;
        }

        return left.name.localeCompare(right.name);
      });

    return next;
  }, [level, office, party, politicians, query, sortBy, state]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-[var(--line)] bg-white p-5">
        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Search politicians
        </label>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search politicians by name, party, state, or office..."
          className="mt-3 w-full rounded-full border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
        />
      </div>

      <FilterBar
        filters={[
          { label: "Chamber", value: office, options: offices },
          { label: "Level", value: level, options: levels },
          { label: "Party", value: party, options: parties },
          { label: "State", value: state, options: states },
          { label: "Sort by", value: sortBy, options: ["Name", "Attendance", "Bills introduced", "Party alignment", "Recent activity"] },
        ]}
        onChange={(label, value) => {
          setPage(1);
          if (label === "Chamber") setOffice(value);
          if (label === "Level") setLevel(value);
          if (label === "Party") setParty(value);
          if (label === "State") setState(value);
          if (label === "Sort by") setSortBy(value);
        }}
      />

      <DataTable
        columns={["Name", "Office", "Party", "State", "Attendance", "Profile", "Watch"]}
        rows={pageRows.map((politician) => [
          <Link key={politician.id} href={`/politicians/${politician.slug}`} className="font-semibold text-[var(--accent)]">
            {politician.name}
          </Link>,
          politician.title,
          politician.party,
          politician.state,
          hasVotePerformanceStats(politician.stats) ? `${politician.stats.attendance}%` : "N/A",
          <Link key={`${politician.id}-profile`} href={`/politicians/${politician.slug}`} className="font-semibold text-[var(--accent)]">
            View profile
          </Link>,
          <WatchButton key={`${politician.id}-watch`} />,
        ])}
      />

      <Pagination page={currentPage} pageSize={PAGE_SIZE} total={filtered.length} />

      {pageCount > 1 ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: pageCount }, (_, index) => index + 1).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setPage(value)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${
                currentPage === value
                  ? "bg-[var(--accent)] text-white"
                  : "bg-white text-[var(--muted)]"
              }`}
            >
              {value}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
