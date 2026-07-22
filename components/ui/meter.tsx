import { cn } from "@/lib/utils";
import { TONE_COLOR, type Tone } from "@/components/ui/tones";

/** Horizontal bar. Values are clamped, so a bad upstream number can't overflow the track. */
export function Meter({
  value,
  max = 100,
  tone = "indigo",
  className,
  /** Overrides the tone fill, for gradients. */
  fill,
}: {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
  fill?: string;
}) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));

  return (
    <span
      className={cn("block h-1.5 overflow-hidden rounded-full bg-white/8", className)}
      role="presentation"
    >
      <span
        className="block h-full rounded-full"
        style={{ width: `${pct}%`, background: fill ?? TONE_COLOR[tone] }}
      />
    </span>
  );
}

/** Label + bar + value row, used for top topics, issue momentum, and ideology scores. */
export function MeterRow({
  label,
  icon,
  value,
  max = 100,
  display,
  tone = "indigo",
  /** Let the bar consume the remaining width instead of a fixed track. */
  fluid,
}: {
  label: string;
  icon?: React.ReactNode;
  value: number;
  max?: number;
  display?: React.ReactNode;
  tone?: Tone;
  fluid?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex min-w-0 flex-1 items-center gap-2 text-[13px] text-[var(--ink)]">
        {icon ? (
          <span className="flex-none text-[var(--muted)] [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <Meter
        value={value}
        max={max}
        tone={tone}
        className={fluid ? "min-w-0 flex-1" : "w-[110px] flex-none"}
      />
      <span className="num w-10 flex-none text-right text-xs text-[var(--muted)]">
        {display ?? value}
      </span>
    </div>
  );
}
