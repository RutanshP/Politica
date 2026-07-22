"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Pagination } from "@/components/pagination";
import { WatchButton } from "@/components/watch-button";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FilterRow, FilterSelect } from "@/components/ui/filter-select";
import { Toolbar } from "@/components/ui/layout";
import { Meter } from "@/components/ui/meter";
import { CellSub, CellTitle, Table } from "@/components/ui/table";
import { partyTone } from "@/components/ui/tones";
import { hasVotePerformanceStats } from "@/lib/utils";
import type { Politician } from "@/types/civic";

export function PoliticiansDirectory({
  politicians,
  total,
  page,
  pageSize,
  needsState,
  filters,
  options,
}: {
  politicians: Politician[];
  total: number;
  page: number;
  pageSize: number;
  /** Level is State but no state has been picked yet, so nothing has been loaded. */
  needsState: boolean;
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
  const isStateLevel = filters.level === "State";

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

  function isDefaultValue(key: string, value: string) {
    return (
      !value
      || value.startsWith("All ")
      || value === "Select a state" // the state placeholder is not a filter
      || (key === "level" && value === "Federal")
      || (key === "sort" && value === "Name")
    );
  }

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (isDefaultValue(key, value)) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    params.delete("page");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  /*
   * Level leads, because it determines what is even loaded. The state dropdown only appears once
   * Level is State -- and until a state is chosen, no legislators are fetched at all.
   */
  const chips = [
    { key: "level", label: "Level", value: filters.level, options: options.levels },
    ...(isStateLevel
      ? [{ key: "state", label: "State", value: filters.state, options: options.states }]
      : []),
    { key: "office", label: "Chamber", value: filters.office, options: options.offices },
    { key: "party", label: "Party", value: filters.party, options: options.parties },
    { key: "sort", label: "Sort by", value: filters.sortBy, options: options.sortOptions },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <form
        className="relative flex items-center"
        onSubmit={(event) => {
          event.preventDefault();
          updateParams({ q: query });
        }}
      >
        <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--faint)]" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, party, state, or office…"
          aria-label="Search politicians"
          className="h-10 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-24 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
        />
        <Button type="submit" variant="primary" size="sm" className="absolute right-1.5">
          Search
        </Button>
      </form>

      <FilterRow>
        {chips.map((chip) => (
          <FilterSelect
            key={chip.key}
            label={chip.label}
            value={chip.value}
            options={chip.options}
            active={!isDefaultValue(chip.key, chip.value)}
            onChange={(value) => {
              // Switching level invalidates the state and chamber choices from the other level.
              if (chip.key === "level") {
                updateParams({ level: value, state: "", office: "", party: "" });
                return;
              }
              updateParams({ [chip.key]: value });
            }}
          />
        ))}
      </FilterRow>

      {needsState ? (
        <EmptyState
          title="Choose a state"
          description="Pick a state above to load its legislators. State members are loaded one state at a time rather than all at once."
        />
      ) : (
        <Card>
          <Toolbar>
            <span className="text-[13px]">
              <b className="num">{total.toLocaleString()}</b>{" "}
              <span className="text-[var(--muted)]">
                {total === 1 ? "member" : "members"} · sorted by {filters.sortBy.toLowerCase()}
              </span>
            </span>
          </Toolbar>

          <Table
            emptyMessage="No members match these filters."
            columns={[
              "Member",
              "Office",
              "Party",
              "State",
              "Attendance",
              { label: "Bills", align: "right" },
              { label: "Watch", align: "right", width: "w-16" },
            ]}
            rows={politicians.map((politician) => {
              const hasStats = hasVotePerformanceStats(politician.stats);

              return [
                <div key={`${politician.id}-name`} className="flex items-center gap-2.5">
                  <Avatar
                    name={politician.name}
                    id={politician.id}
                    party={politician.party}
                  />
                  <span className="min-w-0">
                    <Link
                      href={`/politicians/${politician.slug}`}
                      className="block text-[var(--accent-2)] hover:underline"
                    >
                      <CellTitle>{politician.name}</CellTitle>
                    </Link>
                    <CellSub className="line-clamp-1">
                      {politician.district || politician.state}
                    </CellSub>
                  </span>
                </div>,
                <span key={`${politician.id}-office`} className="text-[var(--muted)]">
                  {politician.title}
                </span>,
                <Badge key={`${politician.id}-party`} tone={partyTone(politician.party)}>
                  {politician.party}
                </Badge>,
                <span key={`${politician.id}-state`} className="text-[var(--muted)]">
                  {politician.state}
                </span>,
                hasStats ? (
                  <span key={`${politician.id}-att`} className="flex items-center gap-2.5">
                    <Meter
                      value={politician.stats.attendance}
                      tone={politician.stats.attendance >= 90 ? "emerald" : "amber"}
                      className="w-[74px] flex-none"
                    />
                    <span className="num text-xs">{politician.stats.attendance}%</span>
                  </span>
                ) : (
                  <span key={`${politician.id}-att`} className="text-xs text-[var(--faint)]">
                    N/A
                  </span>
                ),
                <span key={`${politician.id}-bills`} className="num">
                  {politician.stats.billsIntroduced.toLocaleString()}
                </span>,
                <span key={`${politician.id}-watch`} className="flex justify-end">
                  <WatchButton
                    iconOnly
                    item={{
                      id: politician.id,
                      type: "politician",
                      label: politician.name,
                      subtitle: `${politician.title} · ${politician.state}`,
                      href: `/politicians/${politician.slug}`,
                    }}
                  />
                </span>,
              ];
            })}
          />

          <Pagination page={page} pageSize={pageSize} total={total} buildHref={buildHref} />
        </Card>
      )}
    </div>
  );
}
