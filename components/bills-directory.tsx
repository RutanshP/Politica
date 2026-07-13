"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { DataTable } from "@/components/data-table";
import { FilterBar } from "@/components/filter-bar";
import { Pagination } from "@/components/pagination";
import { StatusPill } from "@/components/status-pill";
import { WatchButton } from "@/components/watch-button";
import type { Bill } from "@/types/civic";

export function BillsDirectory({
  bills,
  committeeSlugs,
  total,
  page,
  pageSize,
  filters,
  options,
}: {
  bills: Bill[];
  /** Slug keyed by committee id and by committee name, for the committees on this page only. */
  committeeSlugs: Record<string, string>;
  total: number;
  page: number;
  pageSize: number;
  filters: {
    query: string;
    level: string;
    state: string;
    chamber: string;
    status: string;
    session: string;
    topic: string;
    sponsor: string;
    committee: string;
    sortBy: string;
  };
  options: {
    levels: string[];
    states: string[];
    chambers: string[];
    statuses: string[];
    sessions: string[];
    topics: string[];
    sponsors: string[];
    committees: string[];
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
      if (!value || value.startsWith("All ") || value === "Both" || value === "Any sponsor" || value === "Any committee" || (key === "sort" && value === "Recent activity")) {
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
          Search bills
        </label>
        <div className="mt-3 flex gap-3">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search bill numbers, sponsors, topics, committees..."
            className="w-full rounded-full border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-700 outline-none"
          />
          <button type="submit" className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-white">
            Apply
          </button>
        </div>
      </form>

      <FilterBar
        filters={[
          { label: "Level", value: filters.level, options: options.levels },
          { label: "State", value: filters.state, options: options.states },
          { label: "Chamber", value: filters.chamber, options: options.chambers },
          { label: "Status", value: filters.status, options: options.statuses },
          { label: "Session", value: filters.session, options: options.sessions },
          { label: "Topic", value: filters.topic, options: options.topics },
          { label: "Sponsor", value: filters.sponsor, options: options.sponsors },
          { label: "Committee", value: filters.committee, options: options.committees },
          { label: "Sort by", value: filters.sortBy, options: options.sortOptions },
        ]}
        onChange={(label, value) => {
          if (label === "Level") updateParams({ level: value });
          if (label === "State") updateParams({ state: value });
          if (label === "Chamber") updateParams({ chamber: value });
          if (label === "Status") updateParams({ status: value });
          if (label === "Session") updateParams({ session: value });
          if (label === "Topic") updateParams({ topic: value });
          if (label === "Sponsor") updateParams({ sponsor: value });
          if (label === "Committee") updateParams({ committee: value });
          if (label === "Sort by") updateParams({ sort: value });
        }}
      />

      <DataTable
        columns={[
          "Bill number",
          "Title",
          "Jurisdiction",
          "Chamber",
          "Status",
          "Last action",
          "Sponsor",
          "Committee",
          "Watch",
        ]}
        rows={bills.map((bill) => {
          const committeeSlug = committeeSlugs[bill.committeeId] || committeeSlugs[bill.committeeName];

          return [
            <Link key={`${bill.id}-number`} href={`/bills/${bill.id}`} className="font-semibold text-[var(--accent)]">
              {bill.number}
            </Link>,
            <div key={`${bill.id}-title`}>
              <p className="font-semibold">{bill.title}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.topic}</p>
            </div>,
            bill.jurisdiction,
            bill.chamber,
            <StatusPill key={`${bill.id}-status`} status={bill.status} />,
            <div key={`${bill.id}-action`}>
              <p>{bill.latestAction}</p>
              <p className="mt-1 text-[var(--muted)]">{bill.lastActionAt}</p>
            </div>,
            bill.sponsorName,
            committeeSlug ? (
              <Link key={`${bill.id}-committee`} href={`/committees/${committeeSlug}`} className="text-[var(--accent)]">
                {bill.committeeName}
              </Link>
            ) : (
              bill.committeeName
            ),
            <WatchButton key={`${bill.id}-watch`} />,
          ];
        })}
      />

      <Pagination page={page} pageSize={pageSize} total={total} buildHref={buildHref} />
    </div>
  );
}
