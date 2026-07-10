"use client";

export function FilterBar({
  filters,
  onChange,
}: {
  filters: Array<{ label: string; value: string; options?: string[] }>;
  onChange?: (label: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {filters.map((filter) => (
        <label
          key={filter.label}
          className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3"
        >
          <span className="block text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">
            {filter.label}
          </span>
          <select
            value={filter.value}
            onChange={(event) => onChange?.(filter.label, event.target.value)}
            className="mt-2 w-full bg-transparent text-sm text-[var(--ink)] outline-none"
          >
            {(filter.options ?? [filter.value]).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
