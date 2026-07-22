"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown, Search } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
import type { Issue } from "@/types/civic";

type SortKey = "name" | "activeBills" | "recentVotes" | "bipartisanSupport";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Issue" },
  { key: "activeBills", label: "Active bills", numeric: true },
  { key: "recentVotes", label: "Recent votes", numeric: true },
  { key: "bipartisanSupport", label: "Bipartisan support", numeric: true },
];

/**
 * Issue directory with a real search box and sortable columns. The old filter dropdowns
 * ("High activity", "Mixed support") rendered but did nothing, and defining what counts as "high"
 * would mean inventing thresholds -- so this filters on the honest signal (name/description text)
 * and lets the reader sort by the actual numbers instead.
 */
export function IssuesDirectory({ issues }: { issues: Issue[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("activeBills");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? issues.filter(
          (issue) =>
            issue.name.toLowerCase().includes(needle) ||
            issue.description.toLowerCase().includes(needle),
        )
      : issues;

    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * direction;
      return (a.stats[sortKey] - b.stats[sortKey]) * direction;
    });
  }, [issues, query, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Numbers are most useful high-to-low; names A-to-Z.
      setSortDir(key === "name" ? "asc" : "desc");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-w-[240px] items-center gap-2 rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 focus-within:border-[var(--line-2)]">
          <Search className="h-3.5 w-3.5 flex-none text-[var(--muted)]" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search issues"
            aria-label="Search issues"
            className="w-full bg-transparent text-[13px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)]"
          />
        </label>
        <p className="text-xs text-[var(--muted)]">
          {rows.length} of {issues.length} issues
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No issues match your search"
          description="Try a broader term, or clear the search to see every tracked issue."
        />
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {COLUMNS.map((column) => {
                  const activeSort = sortKey === column.key;
                  const Icon = !activeSort
                    ? ChevronsUpDown
                    : sortDir === "asc"
                      ? ArrowUp
                      : ArrowDown;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      className={cn(
                        "whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]",
                        column.numeric ? "text-right" : "text-left",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          "flex items-center gap-1.5 transition hover:text-[var(--ink)]",
                          column.numeric && "ml-auto",
                          activeSort && "text-[var(--ink)]",
                        )}
                      >
                        {column.label}
                        <Icon className="h-3 w-3" />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((issue) => (
                <tr
                  key={issue.id}
                  className="border-b border-[var(--line)] transition last:border-b-0 hover:bg-white/2"
                >
                  <td className="px-3.5 py-3 align-middle">
                    <Link href={`/issues/${issue.slug}`} className="font-semibold text-[var(--accent-2)]">
                      {issue.name}
                    </Link>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{issue.description}</span>
                  </td>
                  <td className="px-3.5 py-3 text-right align-middle tabular-nums text-[var(--ink)]">
                    {issue.stats.activeBills}
                  </td>
                  <td className="px-3.5 py-3 text-right align-middle tabular-nums text-[var(--ink)]">
                    {issue.stats.recentVotes}
                  </td>
                  <td className="px-3.5 py-3 text-right align-middle tabular-nums text-[var(--ink)]">
                    {issue.stats.bipartisanSupport}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
