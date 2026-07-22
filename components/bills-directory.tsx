"use client";

import { Filter, LayoutList, Search, Table2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Pagination } from "@/components/pagination";
import { WatchButton } from "@/components/watch-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FilterRow, FilterSelect } from "@/components/ui/filter-select";
import { IconTile } from "@/components/ui/icon-tile";
import { Toolbar } from "@/components/ui/layout";
import { CellSub, CellTitle, Table } from "@/components/ui/table";
import { BILL_STATUS_TONE, TONE_COLOR } from "@/components/ui/tones";
import { TopicIcon, topicVisual } from "@/components/ui/topic-icon";
import { cn } from "@/lib/utils";
import type { Bill } from "@/types/civic";

type ViewMode = "table" | "timeline";

/** Values that mean "no filter applied" and so should be stripped from the querystring. */
function isDefaultValue(key: string, value: string) {
  return (
    !value
    || value.startsWith("All ")
    || value === "Both"
    || value === "Any sponsor"
    || value === "Any committee"
    || (key === "sort" && value === "Recent activity")
  );
}

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
    chamber: string;
    status: string;
    session: string;
    topic: string;
    sponsor: string;
    committee: string;
    sortBy: string;
  };
  options: {
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
  const [view, setView] = useState<ViewMode>("table");
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
      if (isDefaultValue(key, value)) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    params.delete("page");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const filterChips = [
    { key: "chamber", label: "Chamber", value: filters.chamber, options: options.chambers },
    { key: "status", label: "Status", value: filters.status, options: options.statuses },
    { key: "session", label: "Session", value: filters.session, options: options.sessions },
    { key: "topic", label: "Topic", value: filters.topic, options: options.topics },
    { key: "sponsor", label: "Sponsor", value: filters.sponsor, options: options.sponsors },
    { key: "committee", label: "Committee", value: filters.committee, options: options.committees },
    { key: "sort", label: "Sort by", value: filters.sortBy, options: options.sortOptions },
  ];
  const activeCount = filterChips.filter((chip) => !isDefaultValue(chip.key, chip.value)).length
    + (filters.query ? 1 : 0);

  // Timeline mode groups the rows already fetched for this page -- no extra query.
  const grouped = useMemo(() => {
    const map = new Map<string, Bill[]>();
    bills.forEach((bill) => {
      const key = bill.lastActionAt || "Undated";
      const list = map.get(key);
      if (list) list.push(bill);
      else map.set(key, [bill]);
    });
    return [...map.entries()];
  }, [bills]);

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
          placeholder="Search bill numbers, titles, sponsors, committees…"
          aria-label="Search bills"
          className="h-10 w-full min-w-0 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] pl-10 pr-24 text-[13.5px] outline-none transition placeholder:text-[var(--faint)] focus:border-[var(--line-2)] focus:bg-[var(--panel-2)]"
        />
        <Button type="submit" variant="primary" size="sm" className="absolute right-1.5">
          Search
        </Button>
      </form>

      <FilterRow>
        {filterChips.map((chip) => (
          <FilterSelect
            key={chip.key}
            label={chip.label}
            value={chip.value}
            options={chip.options}
            active={!isDefaultValue(chip.key, chip.value)}
            onChange={(value) => updateParams({ [chip.key]: value })}
          />
        ))}
        <span className="ml-auto flex items-center gap-2.5">
          {activeCount > 0 ? (
            <>
              <Badge tone="indigo" icon={<Filter />}>
                {activeCount} active {activeCount === 1 ? "filter" : "filters"}
              </Badge>
              <Link
                href={pathname}
                className="text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]"
              >
                Reset
              </Link>
            </>
          ) : null}
        </span>
      </FilterRow>

      <Card>
        <Toolbar>
          <span className="text-[13px]">
            <b className="num">{total.toLocaleString()}</b>{" "}
            <span className="text-[var(--muted)]">
              {total === 1 ? "result" : "results"} · sorted by {filters.sortBy.toLowerCase()}
            </span>
          </span>
          <span className="ml-auto flex items-center gap-0.5 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--panel-2)] p-0.5">
            {(
              [
                { mode: "table" as const, label: "Table", Icon: Table2 },
                { mode: "timeline" as const, label: "Timeline", Icon: LayoutList },
              ]
            ).map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                aria-pressed={view === mode}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition",
                  view === mode
                    ? "bg-[var(--panel-3)] text-[var(--ink)]"
                    : "text-[var(--muted)] hover:text-[var(--ink)]",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </span>
        </Toolbar>

        {view === "table" ? (
          <Table
            emptyMessage="No bills match these filters."
            columns={[
              "Bill",
              "Chamber",
              "Status",
              "Sponsor",
              "Committee",
              "Last action",
              { label: "Watch", align: "right", width: "w-16" },
            ]}
            rows={bills.map((bill) => {
              const committeeSlug =
                committeeSlugs[bill.committeeId] || committeeSlugs[bill.committeeName];

              return [
                <div key={`${bill.id}-bill`} className="flex items-center gap-2.5">
                  <IconTile tone={topicVisual(bill.topic).tone}>
                    <TopicIcon topic={bill.topic} />
                  </IconTile>
                  <span className="min-w-0">
                    <Link
                      href={`/bills/${bill.id}`}
                      className="block text-[var(--accent-2)] hover:underline"
                    >
                      <CellTitle>{bill.number}</CellTitle>
                    </Link>
                    <CellSub className="line-clamp-1">{bill.title}</CellSub>
                  </span>
                </div>,
                <span key={`${bill.id}-chamber`} className="text-[var(--muted)]">
                  {bill.chamber}
                </span>,
                <Badge key={`${bill.id}-status`} tone={BILL_STATUS_TONE[bill.status]}>
                  {bill.status}
                </Badge>,
                <span key={`${bill.id}-sponsor`} className="text-[var(--muted)]">
                  {bill.sponsorName}
                </span>,
                committeeSlug ? (
                  <Link
                    key={`${bill.id}-committee`}
                    href={`/committees/${committeeSlug}`}
                    className="text-[var(--accent-2)] hover:underline"
                  >
                    {bill.committeeName}
                  </Link>
                ) : (
                  <span key={`${bill.id}-committee`} className="text-[var(--muted)]">
                    {bill.committeeName}
                  </span>
                ),
                <span key={`${bill.id}-action`}>
                  <span className="block text-xs">{bill.latestAction}</span>
                  <CellSub className="num">{bill.lastActionAt}</CellSub>
                </span>,
                <span key={`${bill.id}-watch`} className="flex justify-end">
                  <WatchButton
                    iconOnly
                    item={{
                      id: bill.id,
                      type: "bill",
                      label: `${bill.number} · ${bill.title}`,
                      subtitle: bill.committeeName,
                      href: `/bills/${bill.id}`,
                    }}
                  />
                </span>,
              ];
            })}
          />
        ) : (
          <CardBody>
            {grouped.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-[var(--muted)]">
                No bills match these filters.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {grouped.map(([date, group]) => (
                  <div key={date} className="flex gap-4">
                    <span className="num w-24 flex-none pt-0.5 text-right text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
                      {date}
                    </span>
                    <div className="flex flex-1 flex-col gap-3 border-l border-[var(--line-2)] pl-4">
                      {group.map((bill) => (
                        <Link key={bill.id} href={`/bills/${bill.id}`} className="relative block">
                          <span
                            className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[var(--panel)]"
                            style={{ background: TONE_COLOR[BILL_STATUS_TONE[bill.status]] }}
                          />
                          <span className="block text-[13px] font-medium">
                            {bill.number} · {bill.title}
                          </span>
                          <span className="mt-0.5 block text-xs text-[var(--muted)]">
                            {bill.latestAction} · {bill.committeeName}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        )}

        <Pagination page={page} pageSize={pageSize} total={total} buildHref={buildHref} />
      </Card>
    </div>
  );
}
