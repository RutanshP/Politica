import { cn } from "@/lib/utils";

/**
 * A single circular percentage ring, matching the "Key Stats" donuts in the mockup. Pure SVG --
 * no chart library, so it renders in the server component without shipping recharts.
 */
export function StatDonut({
  value,
  label,
  tone = "sky",
  size = 104,
}: {
  value: number | null;
  label: string;
  tone?: "emerald" | "sky" | "amber" | "rose";
  size?: number;
}) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const dash = (pct / 100) * circumference;

  const toneColor = {
    emerald: "#22c55e",
    sky: "#2563eb",
    amber: "#f59e0b",
    rose: "#f43f5e",
  }[tone];

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
          {value != null ? (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={toneColor}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circumference - dash}`}
            />
          ) : null}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn("font-display text-xl font-semibold", value == null ? "text-[var(--muted)]" : "text-[var(--ink)]")}>
            {value == null ? "N/A" : `${Math.round(pct)}%`}
          </span>
        </div>
      </div>
      <p className="text-center text-xs font-semibold text-[var(--muted)]">{label}</p>
    </div>
  );
}
