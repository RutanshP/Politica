import Link from "next/link";

import { formatMoney } from "@/components/funding/funding-graph-theme";
import { cn } from "@/lib/utils";

/** Spend per quarter as bars, the tallest quarter full height. Quarters with no reports yet show empty. */
export function QuarterBars({
  quarters,
  className,
}: {
  quarters: Array<{ label: string; spend: number; pending?: boolean }>;
  className?: string;
}) {
  const max = Math.max(1, ...quarters.map((quarter) => quarter.spend));
  return (
    <div className={cn("flex h-40 items-end gap-3", className)}>
      {quarters.map((quarter) => (
        <div key={quarter.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
          <span className="num text-[11.5px] font-semibold text-[var(--ink)]">
            {quarter.pending ? "—" : formatMoney(quarter.spend) || "$0"}
          </span>
          <div className="flex h-28 w-full items-end rounded-[var(--r-sm)] bg-white/4">
            <div
              className="w-full rounded-[var(--r-sm)] bg-[var(--accent)]"
              style={{ height: quarter.pending ? 0 : `${Math.max(2, (quarter.spend / max) * 100)}%` }}
            />
          </div>
          <span className="text-[11px] text-[var(--muted)]">{quarter.label}</span>
        </div>
      ))}
    </div>
  );
}

/** Pill links for switching the year a page covers. */
export function YearSwitch({ years, active, hrefFor }: { years: number[]; active: number; hrefFor: (year: number) => string }) {
  return (
    <div className="flex gap-1 rounded-full border border-[var(--line)] bg-[var(--panel)] p-1" role="group" aria-label="Year">
      {years.map((year) => (
        <Link
          key={year}
          href={hrefFor(year)}
          aria-current={year === active ? "page" : undefined}
          className={cn(
            "num rounded-full px-3 py-1 text-xs font-semibold transition",
            year === active ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:text-[var(--ink)]",
          )}
        >
          {year}
        </Link>
      ))}
    </div>
  );
}

/** How the figures are counted -- shown wherever lobbying money is, because it is not obvious. */
export function LobbyingMethodNote() {
  return (
    <p className="text-[11.5px] leading-relaxed text-[var(--faint)]">
      From Lobbying Disclosure Act reports filed with Congress. Each quarter counts once per organization: its own
      in-house report when it filed one, which already includes what it paid outside firms, otherwise the sum of its
      firms&apos; reports. Amended reports replace the original. Firms report nothing under $5,000 a quarter.
      Reports name the bills lobbied on but not how the money was split between them, so bills show organizations,
      not dollars.
    </p>
  );
}
