"use client";

import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Stacked label-over-value filter chip with a real <select> layered invisibly on top, so the
 * native picker (and its keyboard behavior) is preserved while the chip carries the styling.
 */
export function FilterSelect({
  label,
  value,
  options,
  onChange,
  /** Highlights the chip when the value is something other than the default. */
  active,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  active?: boolean;
}) {
  return (
    <label
      className={cn(
        "relative flex min-w-[112px] cursor-pointer flex-col gap-px rounded-[var(--r-sm)] border px-3 py-1.5 transition",
        active
          ? "border-[rgba(99,102,241,0.4)] bg-[rgba(99,102,241,0.06)]"
          : "border-[var(--line)] bg-[var(--panel)] hover:border-[var(--line-2)]",
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--faint)]">
        {label}
      </span>
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--ink)]">
        <span className="truncate">{value}</span>
        <ChevronDown className="ml-auto h-3.5 w-3.5 flex-none text-[var(--muted)]" />
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2.5">{children}</div>;
}
