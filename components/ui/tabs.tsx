import Link from "next/link";

import { cn } from "@/lib/utils";

export interface TabItem {
  label: string;
  href: string;
  active?: boolean;
  /** Rendered as a small count badge after the label. Omit when the count is unknown. */
  count?: number;
  icon?: React.ReactNode;
}

/**
 * Underline tabs. Replaces the old pill tabs, which floated free of their content and gave no
 * sense that the tab strip and the panel below it were the same surface.
 */
export function Tabs({ items, className }: { items: TabItem[]; className?: string }) {
  return (
    <div
      className={cn(
        "flex gap-0.5 overflow-x-auto border-b border-[var(--line)]",
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={`${item.label}-${item.href}`}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] font-medium transition",
            item.active
              ? "border-[var(--accent)] text-[var(--ink)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          {item.icon ? (
            <span className="[&>svg]:h-3.5 [&>svg]:w-3.5">{item.icon}</span>
          ) : null}
          {item.label}
          {item.count != null ? (
            <span
              className={cn(
                "num rounded-full px-1.5 py-px text-[11px] font-semibold",
                item.active
                  ? "bg-[var(--accent-soft)] text-[var(--accent-2)]"
                  : "bg-white/6 text-[var(--muted)]",
              )}
            >
              {item.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
