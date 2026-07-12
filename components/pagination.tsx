import Link from "next/link";

export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
}: {
  page: number;
  pageSize: number;
  total: number;
  buildHref?: (page: number) => string;
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
        {buildHref ? (
          <>
            <Link
              href={buildHref(Math.max(1, page - 1))}
              className={`rounded-full border border-[var(--line)] bg-white px-3 py-1.5 ${
                page <= 1 ? "pointer-events-none opacity-50" : ""
              }`}
            >
              Previous
            </Link>
            <Link
              href={buildHref(Math.min(pageCount, page + 1))}
              className={`rounded-full border border-[var(--line)] bg-white px-3 py-1.5 ${
                page >= pageCount ? "pointer-events-none opacity-50" : ""
              }`}
            >
              Next
            </Link>
          </>
        ) : null}
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
