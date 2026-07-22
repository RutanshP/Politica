"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

import { FilterRow, FilterSelect } from "@/components/ui/filter-select";
import { cn } from "@/lib/utils";
import type { VotePosition } from "@/types/civic";

type SortKey = "name" | "party" | "state" | "vote";
type SortDir = "asc" | "desc";

const ALL_PARTIES = "All parties";
const ALL_STATES = "All states";
const ALL_VOTES = "All vote positions";

// Sort order for the Vote column: the decision first, abstentions last.
const VOTE_RANK: Record<VotePosition["vote"], number> = {
  Yea: 0,
  Nay: 1,
  Present: 2,
  "Not Voting": 3,
};

function voteStyle(vote: VotePosition["vote"]) {
  if (vote === "Yea") return "text-[var(--success)]";
  if (vote === "Nay") return "text-[var(--danger)]";
  if (vote === "Present") return "text-[var(--warning)]";
  return "text-[var(--muted)]";
}

/**
 * Member-by-member vote table with real Party / State / Vote filters and sortable columns. The
 * previous version rendered the same dropdowns with no handler, so nothing they selected changed
 * the table -- this owns the state client-side and filters the positions in memory (the full
 * roster is already on the page, so no extra fetch).
 */
export function MemberVoteTable({ positions }: { positions: VotePosition[] }) {
  const [party, setParty] = useState(ALL_PARTIES);
  const [stateFilter, setStateFilter] = useState(ALL_STATES);
  const [position, setPosition] = useState(ALL_VOTES);
  const [sortKey, setSortKey] = useState<SortKey>("vote");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const partyOptions = useMemo(
    () => [ALL_PARTIES, ...[...new Set(positions.map((p) => p.party).filter(Boolean))].sort()],
    [positions],
  );
  const stateOptions = useMemo(
    () => [ALL_STATES, ...[...new Set(positions.map((p) => p.state).filter(Boolean))].sort()],
    [positions],
  );

  const rows = useMemo(() => {
    const filtered = positions.filter(
      (p) =>
        (party === ALL_PARTIES || p.party === party) &&
        (stateFilter === ALL_STATES || p.state === stateFilter) &&
        (position === ALL_VOTES || p.vote === position),
    );

    const direction = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "vote") {
        const diff = VOTE_RANK[a.vote] - VOTE_RANK[b.vote];
        return (diff || a.name.localeCompare(b.name)) * direction;
      }
      return a[sortKey].localeCompare(b[sortKey]) * direction;
    });
  }, [positions, party, stateFilter, position, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const columns: { key: SortKey; label: string }[] = [
    { key: "name", label: "Member" },
    { key: "party", label: "Party" },
    { key: "state", label: "State" },
    { key: "vote", label: "Vote" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <FilterRow>
          <FilterSelect
            label="Party"
            value={party}
            options={partyOptions}
            onChange={setParty}
            active={party !== ALL_PARTIES}
          />
          <FilterSelect
            label="State"
            value={stateFilter}
            options={stateOptions}
            onChange={setStateFilter}
            active={stateFilter !== ALL_STATES}
          />
          <FilterSelect
            label="Vote"
            value={position}
            options={[ALL_VOTES, "Yea", "Nay", "Present", "Not Voting"]}
            onChange={setPosition}
            active={position !== ALL_VOTES}
          />
        </FilterRow>
        <p className="text-xs text-[var(--muted)]">
          {rows.length} of {positions.length} members
        </p>
      </div>

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              {columns.map((column) => {
                const activeSort = sortKey === column.key;
                const Icon = !activeSort ? ChevronsUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    className="whitespace-nowrap border-b border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={cn(
                        "flex items-center gap-1.5 transition hover:text-[var(--ink)]",
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3.5 py-10 text-center text-[var(--muted)]">
                  No members match these filters.
                </td>
              </tr>
            ) : (
              rows.map((p) => (
                <tr
                  key={p.politicianId || p.name}
                  className="border-b border-[var(--line)] transition last:border-b-0 hover:bg-white/2"
                >
                  <td className="px-3.5 py-3 align-middle font-medium text-[var(--ink)]">{p.name}</td>
                  <td className="px-3.5 py-3 align-middle text-[var(--ink)]">{p.party}</td>
                  <td className="px-3.5 py-3 align-middle text-[var(--ink)]">{p.state}</td>
                  <td className={cn("px-3.5 py-3 align-middle font-semibold", voteStyle(p.vote))}>
                    {p.vote}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
