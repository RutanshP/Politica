import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Bill, BillStatus } from "@/types/civic";

// Where each status sits on the legislative path. Higher = further along.
const STATUS_ORDER: Record<BillStatus, number> = {
  Introduced: 0,
  "In Committee": 1,
  "On Floor": 2,
  "Passed Chamber": 3,
  "Sent to President": 4,
  Signed: 5,
  Failed: -1,
};

// The four milestones shown in the stepper, each with the status level that "reaches" it.
const MILESTONES: Array<{ label: string; reachedAt: number; match: RegExp }> = [
  { label: "Introduced", reachedAt: 0, match: /introduc/i },
  { label: "Passed Chamber", reachedAt: 3, match: /passed|agreed to/i },
  { label: "To President", reachedAt: 4, match: /president/i },
  { label: "Signed into Law", reachedAt: 5, match: /became law|signed|public law/i },
];

function findActionDate(bill: Bill, match: RegExp) {
  const action = bill.actions.find((item) => match.test(item.label) || match.test(item.detail));
  return action?.date;
}

export function BillProgressStepper({ bill }: { bill: Bill }) {
  const current = STATUS_ORDER[bill.status] ?? 0;
  const failed = bill.status === "Failed";

  return (
    <div className="rounded-3xl border border-[var(--line)] bg-white p-5">
      <div className="flex items-center justify-between gap-4">
        {MILESTONES.map((milestone, index) => {
          const reached = !failed && current >= milestone.reachedAt;
          const isCurrent = !failed
            && current >= milestone.reachedAt
            && (index === MILESTONES.length - 1 || current < MILESTONES[index + 1].reachedAt);
          const date = reached ? findActionDate(bill, milestone.match) : undefined;

          return (
            <div key={milestone.label} className="flex flex-1 items-center gap-3 last:flex-none">
              <div className="flex flex-col items-center gap-2 text-center">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ring-4",
                    reached
                      ? "bg-emerald-500 text-white ring-emerald-100"
                      : isCurrent
                        ? "bg-sky-500 text-white ring-sky-100"
                        : "bg-slate-100 text-[var(--muted)] ring-transparent",
                  )}
                >
                  {reached ? <Check className="h-4 w-4" /> : index + 1}
                </span>
                <div>
                  <p className={cn("text-xs font-semibold", reached || isCurrent ? "text-[var(--ink)]" : "text-[var(--muted)]")}>
                    {milestone.label}
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {date || (reached ? "Reached" : isCurrent ? "In progress" : "Not reached")}
                  </p>
                </div>
              </div>
              {index < MILESTONES.length - 1 ? (
                <span
                  className={cn(
                    "h-0.5 flex-1 rounded-full",
                    !failed && current > milestone.reachedAt ? "bg-emerald-400" : "bg-slate-200",
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      {failed ? (
        <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
          This measure failed and did not advance.
        </p>
      ) : null}
    </div>
  );
}
