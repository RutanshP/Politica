import { ArrowDown, ArrowUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tones";

export interface StatDelta {
  value: number;
  direction: "up" | "down";
}

/**
 * Computes a period-over-period delta from a series, or returns undefined when the series is
 * too short to support one. Tiles render no delta at all rather than an invented zero -- the
 * absence is meaningful, it means the data layer can't back the comparison.
 */
export function deltaFromSeries(
  series: Array<{ value: number }> | undefined,
): StatDelta | undefined {
  if (!series || series.length < 2) return undefined;
  const latest = series[series.length - 1]?.value;
  const previous = series[series.length - 2]?.value;
  if (!Number.isFinite(latest) || !Number.isFinite(previous)) return undefined;
  const change = Math.round(latest - previous);
  if (change === 0) return undefined;
  return { value: Math.abs(change), direction: change > 0 ? "up" : "down" };
}

export function StatTile({
  label,
  value,
  icon,
  tone = "indigo",
  delta,
  footnote,
  suffix,
  className,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  tone?: Tone;
  delta?: StatDelta;
  footnote?: string;
  /** Rendered small and muted after the value, e.g. "%". */
  suffix?: string;
  className?: string;
}) {
  const DeltaIcon = delta?.direction === "down" ? ArrowDown : ArrowUp;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-2.5 rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-2.5">
        {icon ? <IconTile tone={tone}>{icon}</IconTile> : null}
        <span className="text-xs leading-tight text-[var(--muted)]">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
          {value}
        </span>
        {suffix ? <span className="text-sm text-[var(--muted)]">{suffix}</span> : null}
        {delta ? (
          <span
            className={cn(
              "num inline-flex items-center gap-0.5 text-xs font-semibold",
              delta.direction === "up" ? "text-[var(--success)]" : "text-[var(--danger)]",
            )}
          >
            <DeltaIcon className="h-3 w-3" />
            {delta.value.toLocaleString()}
          </span>
        ) : null}
      </div>
      {footnote ? (
        <p className="text-[11.5px] leading-snug text-[var(--faint)]">{footnote}</p>
      ) : null}
    </div>
  );
}
