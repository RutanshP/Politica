import { cn } from "@/lib/utils";
import { PILL_TONE, type Tone } from "@/components/ui/tones";

const SIZES = {
  sm: "h-7 w-7 [&>svg]:h-3.5 [&>svg]:w-3.5",
  md: "h-8.5 w-8.5 [&>svg]:h-4 [&>svg]:w-4",
  lg: "h-11 w-11 [&>svg]:h-5 [&>svg]:w-5",
  xl: "h-19 w-19 rounded-[var(--r-lg)] [&>svg]:h-8.5 [&>svg]:w-8.5",
} as const;

/**
 * The rounded, tinted square that fronts an entity in a list row, table cell, or hero.
 * Carries the same tone vocabulary as Badge so a bill reads the same everywhere it appears.
 */
export function IconTile({
  children,
  tone = "indigo",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid flex-none place-items-center rounded-[var(--r-sm)]",
        PILL_TONE[tone],
        SIZES[size],
        className,
      )}
    >
      {children}
    </span>
  );
}
