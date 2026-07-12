"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { WatchButton } from "@/components/watch-button";
import { hasVotePerformanceStats } from "@/lib/utils";
import type { Politician } from "@/types/civic";

export function PoliticiansDirectory({
  politicians,
  total,
  page,
  pageSize,
  filters,
  options,
}: {
  politicians: Politician[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    query: string;
    office: string;
    level: string;
    party: string;
    state: string;
    sortBy: string;
  };
  options: {
    offices: string[];
    levels: string[];
    parties: string[];
    states: string[];
    sortOptions: string[];
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(filters.query);

  const buildHref = useMemo(
    () => (nextPage: number) => {
      const params = new URLSearchParams(searchParams.toString());
      if (nextPage <= 1) {
        params.delete("page");
      } else {
        params.set("page", String(nextPage));
      }
      const queryString = params.toString();
      return queryString ? `${pathname}?${queryString}` : pathname;
    },
    [pathname, searchParams],
  );

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (!value || value.startsWith("All ") || (key === "sort" && value === "Name")) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    params.delete("page");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  return (
    <div className="space-y-6">
      <form
        className="rounded-[28px] border border-[var(--line)] bg-white p-5"
        onSubmit={(event) => {
          event.preventDefault();
          updateParams({ q: query });
        }}
      >
        <label className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
          Search politicians
        </label>
        <div className="mt-3 flex gap-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search politicians by name, party, state, or office..."
            className="w-full rounded-full border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
          />
          <button type="submit" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white">
            Apply
          </button>
        </div>
      </form>

      <FilterBar
        filters={[
          { label: "Chamber", value: filters.office, options: options.offices },
          { label: "Level", value: filters.level, options: options.levels },
          { label: "Party", value: filters.party, options: options.parties },
          { label: "State", value: filters.state, options: options.states },
          { label: "Sort by", value: filters.sortBy, options: options.sortOptions },
        ]}
        onChange={(label, value) => {
          if (label === "Chamber") updateParams({ office: value });
          if (label === "Level") updateParams({ level: value });
          if (label === "Party") updateParams({ party: value });
          if (label === "State") updateParams({ state: value });
          if (label === "Sort by") updateParams({ sort: value });
        }}
      />

      <DataTable
        columns={["Name", "Office", "Party", "State", "Attendance", "Profile", "Watch"]}
        rows={politicians.map((politician) => [
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

      <Pagination page={page} pageSize={pageSize} total={total} buildHref={buildHref} />
    </div>
  );
}
