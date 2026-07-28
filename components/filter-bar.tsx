"use client";

import { FilterRow, FilterSelect } from "@/components/ui/filter-select";

/**
 * Compatibility wrapper for pages that still pass label-keyed filters. New screens should use
 * FilterSelect directly, which keys on the querystring param rather than the display label.
 */
export function FilterBar({
  filters,
  onChange,
  /** Extra controls rendered alongside the selects, e.g. the sort-direction toggle. */
  children,
}: {
  filters: Array<{ label: string; value: string; options?: string[] }>;
  onChange?: (label: string, value: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <FilterRow>
      {filters.map((filter) => (
        <FilterSelect
          key={filter.label}
          label={filter.label}
          value={filter.value}
          options={filter.options ?? [filter.value]}
          onChange={(value) => onChange?.(filter.label, value)}
        />
      ))}
      {children}
    </FilterRow>
  );
}
