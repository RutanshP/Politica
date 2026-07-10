"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { WatchButton } from "@/components/watch-button";
import type { Politician } from "@/types/civic";

const PAGE_SIZE = 20;

export function PoliticiansDirectory({
  politicians,
}: {
  politicians: Politician[];
}) {
  const parties = useMemo(
    () => ["All parties", ...new Set(politicians.map((politician) => politician.party))],
    [politicians],
  );
  const states = useMemo(
    () => ["All states", ...new Set(politicians.map((politician) => politician.state))],
    [politicians],
  );

  const [query, setQuery] = useState("");
  const [party, setParty] = useState("All parties");
  const [state, setState] = useState("All states");
  const [chamber, setChamber] = useState("All chambers");
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
        const matchesParty = party === "All parties" || politician.party === party;
        const matchesState = state === "All states" || politician.state === state;
        const matchesChamber =
          chamber === "All chambers"
          || (chamber === "Senate" && politician.title.includes("Senator"))
          || (chamber === "House" && politician.title.includes("Representative"));

        return matchesQuery && matchesParty && matchesState && matchesChamber;
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
  }, [chamber, party, politicians, query, sortBy, state]);

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
          { label: "Party", value: party, options: parties },
          { label: "State", value: state, options: states },
          { label: "Chamber", value: chamber, options: ["All chambers", "House", "Senate"] },
          { label: "Sort by", value: sortBy, options: ["Name", "Attendance", "Bills introduced", "Party alignment", "Recent activity"] },
        ]}
        onChange={(label, value) => {
          setPage(1);
          if (label === "Party") setParty(value);
          if (label === "State") setState(value);
          if (label === "Chamber") setChamber(value);
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
          `${politician.stats.attendance}%`,
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

