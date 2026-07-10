export function Pagination({
  page,
  pageSize,
  total,
}: {
  page: number;
  pageSize: number;
  total: number;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-3 rounded-[28px] border border-white/60 bg-[var(--panel)] px-5 py-4 text-sm text-[var(--muted)] shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {start}-{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5">
          Page {page}
        </span>
        <span className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5">
          {pageCount} total
        </span>
      </div>
    </div>
  );
}
