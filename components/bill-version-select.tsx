"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import type { BillVersionEntry } from "@/lib/bill-versions";
import { cn } from "@/lib/utils";

/**
 * The control that decides what Text and Votes show.
 *
 * A native <select> rather than a custom menu: it is keyboard and screen-reader correct for free,
 * it renders as the platform's own picker on mobile, and a bill can carry 21 options -- H.R. 8800
 * does -- which a hand-rolled listbox would have to virtualize and trap focus in.
 *
 * Options are grouped so amendments and bill texts stay legible in one list, and each label leads
 * with the date because ordering by date is the whole point of the list.
 */
export function BillVersionSelect({
  entries,
  selectedId,
  billId,
  view,
}: {
  entries: BillVersionEntry[];
  selectedId: string;
  billId: string;
  view: "text" | "votes";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const amendments = entries.filter((entry) => entry.kind === "amendment");
  const texts = entries.filter((entry) => entry.kind === "text");

  const optionLabel = (entry: BillVersionEntry) =>
    [
      entry.date,
      entry.label,
      entry.sponsor ? `· ${entry.sponsor}` : "",
      entry.result ? `· ${entry.result}` : "",
    ].filter(Boolean).join(" ");

  return (
    <label className="flex min-w-0 items-center gap-2.5">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
        Version
      </span>
      <select
        aria-label="Select the bill version or amendment to view"
        value={selectedId}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => {
            // The view rides along so switching version does not throw you back to Text.
            router.push(`/bills/${encodeURIComponent(billId)}/version?v=${encodeURIComponent(next)}&view=${view}`);
          });
        }}
        className={cn(
          "min-w-0 max-w-full flex-1 truncate rounded-[var(--r-sm)] border border-[var(--line-2)]",
          "bg-[var(--panel-2)] px-3 py-2 text-[13px] font-medium text-[var(--ink)]",
          "transition hover:border-[var(--accent-2)] focus-visible:outline focus-visible:outline-2",
          "focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-2)]",
          pending && "opacity-60",
        )}
      >
        {amendments.length > 0 ? (
          <optgroup label={`Proposed amendments (${amendments.length})`}>
            {amendments.map((entry) => (
              <option key={entry.id} value={entry.id}>{optionLabel(entry)}</option>
            ))}
          </optgroup>
        ) : null}
        {texts.length > 0 ? (
          <optgroup label={`Bill text (${texts.length})`}>
            {texts.map((entry) => (
              <option key={entry.id} value={entry.id}>{optionLabel(entry)}</option>
            ))}
          </optgroup>
        ) : null}
      </select>
    </label>
  );
}
