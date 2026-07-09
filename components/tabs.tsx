import Link from "next/link";

import { cn } from "@/lib/utils";

export function Tabs({
  items,
}: {
  items: Array<{ label: string; href: string; active?: boolean }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={`${item.label}-${item.href}`}
          href={item.href}
          className={cn(
            "rounded-full px-4 py-2 text-sm font-semibold transition",
            item.active
              ? "bg-[var(--accent)] text-white"
              : "bg-white text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
