import Link from "next/link";

const BUTTON_CLASS = "rounded-full border border-[var(--line)] bg-white px-3 py-1.5";

/**
 * Supports two modes: `buildHref` for URL-driven pagination (server pages), and `onPageChange`
 * for client components that hold the page in local state. Previously only buildHref rendered
 * the Prev/Next controls, so client-state directories (committees) had no way to page.
 */
export function Pagination({
  page,
  pageSize,
  total,
  buildHref,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  buildHref?: (page: number) => string;
  onPageChange?: (page: number) => void;
}) {
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const prevPage = Math.max(1, page - 1);
  const nextPage = Math.min(pageCount, page + 1);

  return (
    <div className="flex flex-col gap-3 rounded-[28px] border border-white/60 bg-[var(--panel)] px-5 py-4 text-sm text-[var(--muted)] shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
      <p>
        Showing {start}-{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        {buildHref ? (
          <>
            <Link href={buildHref(prevPage)} className={`${BUTTON_CLASS} ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}>
              Previous
            </Link>
            <Link href={buildHref(nextPage)} className={`${BUTTON_CLASS} ${page >= pageCount ? "pointer-events-none opacity-50" : ""}`}>
              Next
            </Link>
          </>
        ) : onPageChange ? (
          <>
            <button type="button" onClick={() => onPageChange(prevPage)} disabled={page <= 1} className={`${BUTTON_CLASS} disabled:opacity-50`}>
              Previous
            </button>
            <button type="button" onClick={() => onPageChange(nextPage)} disabled={page >= pageCount} className={`${BUTTON_CLASS} disabled:opacity-50`}>
              Next
            </button>
          </>
        ) : null}
        <span className={BUTTON_CLASS}>Page {page}</span>
        <span className={BUTTON_CLASS}>{pageCount} total</span>
      </div>
    </div>
  );
}
