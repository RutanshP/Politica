import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

const CONTROL =
  "num inline-grid h-7.5 min-w-7.5 place-items-center rounded-md px-2 text-xs text-[var(--muted)] transition hover:bg-[var(--panel-2)] hover:text-[var(--ink)]";
const ACTIVE = "bg-[var(--accent)] font-semibold text-white hover:bg-[var(--accent)] hover:text-white";
const DISABLED = "pointer-events-none opacity-40";

/**
 * Builds a windowed page list: always the first and last page, plus a window around the current
 * one, with `null` marking an elision. Keeps the control at a fixed width no matter how many
 * pages exist (the bills directory runs to 50+).
 */
function pageWindow(page: number, pageCount: number): Array<number | null> {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount, page]);
  for (let offset = 1; offset <= 1; offset += 1) {
    if (page - offset > 1) pages.add(page - offset);
    if (page + offset < pageCount) pages.add(page + offset);
  }
  // Keep the leading run stable so the control doesn't reflow while paging through the start.
  if (page <= 3) [2, 3, 4].forEach((value) => value < pageCount && pages.add(value));
  if (page >= pageCount - 2) {
    [pageCount - 1, pageCount - 2, pageCount - 3].forEach((value) => value > 1 && pages.add(value));
  }

  const sorted = [...pages].sort((left, right) => left - right);
  const result: Array<number | null> = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) result.push(null);
    result.push(value);
  });
  return result;
}

/**
 * Supports two modes: `buildHref` for URL-driven pagination (server pages), and `onPageChange`
 * for client components that hold the page in local state. Previously only buildHref rendered
 * the Prev/Next controls, so client-state directories (committees) had no way to page.
 *
 * Renders as a flat strip with a top hairline, intended as the last child of a Card.
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

  function control(target: number, content: React.ReactNode, key: string, disabled?: boolean) {
    const classes = cn(CONTROL, target === page && content !== null && ACTIVE, disabled && DISABLED);

    if (buildHref) {
      return (
        <Link key={key} href={buildHref(target)} className={classes}>
          {content}
        </Link>
      );
    }
    return (
      <button
        key={key}
        type="button"
        onClick={() => onPageChange?.(target)}
        disabled={disabled}
        className={cn(classes, "disabled:pointer-events-none disabled:opacity-40")}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="flex flex-none flex-wrap items-center gap-3 border-t border-[var(--line)] px-3.5 py-3">
      <p className="text-xs text-[var(--muted)]">
        Showing <span className="num">{start.toLocaleString()}–{end.toLocaleString()}</span> of{" "}
        <span className="num">{total.toLocaleString()}</span>
      </p>
      {buildHref || onPageChange ? (
        <div className="ml-auto flex items-center gap-1">
          {control(prevPage, <ChevronLeft className="h-3.5 w-3.5" />, "prev", page <= 1)}
          {pageWindow(page, pageCount).map((value, index) =>
            value === null ? (
              <span key={`gap-${index}`} className="px-1 text-xs text-[var(--faint)]">
                …
              </span>
            ) : (
              control(value, value.toLocaleString(), `p-${value}`)
            ),
          )}
          {control(nextPage, <ChevronRight className="h-3.5 w-3.5" />, "next", page >= pageCount)}
        </div>
      ) : null}
    </div>
  );
}
