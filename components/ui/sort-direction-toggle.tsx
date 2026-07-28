"use client";

import { ArrowDownNarrowWide, ArrowUpNarrowWide } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  flipSortDirection,
  isNaturalSortDirection,
  sortDirectionLabel,
  type SortDirection,
} from "@/lib/sort-direction";

/**
 * One control that reverses whatever the active sort is, shaped like the filter chips beside it.
 * Highlights only once flipped, so the natural order stays visually quiet.
 */
export function SortDirectionToggle({
  sortBy,
  direction,
  onChange,
}: {
  sortBy: string;
  direction: SortDirection;
  onChange: (direction: SortDirection) => void;
}) {
  const flipped = !isNaturalSortDirection(sortBy, direction);
  const Icon = direction === "desc" ? ArrowDownNarrowWide : ArrowUpNarrowWide;
  const label = sortDirectionLabel(sortBy, direction);

  return (
    <button
      type="button"
      onClick={() => onChange(flipSortDirection(direction))}
      title={`Sorted ${label.toLowerCase()} — click to reverse`}
      aria-label={`Sort order: ${label}. Activate to reverse.`}
      className={cn(
        "flex min-w-[112px] cursor-pointer flex-col gap-px rounded-[var(--r-sm)] border px-3 py-1.5 text-left transition",
        flipped
          ? "border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.06)]"
          : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-2)]",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
        Order
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink)]">
        <span className="truncate">{label}</span>
        <Icon className="ml-auto h-3.5 w-3.5 flex-none text-[var(--muted)]" />
      </span>
    </button>
  );
}
