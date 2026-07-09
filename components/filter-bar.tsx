export function FilterBar({
  filters,
}: {
  filters: Array<{ label: string; value: string; options?: string[] }>;
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
            defaultValue={filter.value}
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
