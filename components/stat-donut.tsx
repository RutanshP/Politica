import { cn } from "@/lib/utils";
import { TONE_COLOR, type Tone } from "@/components/ui/tones";

/**
 * A single circular percentage ring. Pure SVG -- no chart library, so it renders in a server
 * component without shipping recharts. A null value renders the empty track and "N/A" rather
 * than a zeroed ring, which would read as a real measurement of zero.
 */
export function StatDonut({
  value,
  label,
  tone = "sky",
  size = 88,
}: {
  value: number | null;
  label: string;
  tone?: Tone;
  size?: number;
}) {
  const stroke = 8;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={stroke}
          />
          {value != null ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={TONE_COLOR[tone]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className={cn(
              "num text-[17px] font-semibold",
              value == null ? "text-[var(--faint)]" : "text-[var(--ink)]",
            )}
          >
            {value == null ? "N/A" : `${Math.round(pct)}%`}
          </span>
        </div>
      </div>
      <p className="text-xs leading-snug text-[var(--muted)]">{label}</p>
    </div>
  );
}
