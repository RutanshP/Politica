import { Check, FileText, Gavel, Landmark, Users, Vote } from "lucide-react";

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

/**
 * One milestone per rung of STATUS_ORDER, so the stepper is a direct rendering of the stored
 * status rather than a separate model that could drift from it. `match` is only used to pull a
 * date out of the action list for milestones already reached.
 */
const MILESTONES: Array<{
  label: string;
  reachedAt: number;
  match: RegExp;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { label: "Introduced", reachedAt: 0, match: /introduc/i, icon: FileText },
  { label: "In Committee", reachedAt: 1, match: /committee/i, icon: Users },
  { label: "On Floor", reachedAt: 2, match: /floor|debate|cloture/i, icon: Gavel },
  { label: "Passed Chamber", reachedAt: 3, match: /passed|agreed to/i, icon: Check },
  { label: "To President", reachedAt: 4, match: /president/i, icon: Landmark },
  { label: "Signed into Law", reachedAt: 5, match: /became law|signed|public law/i, icon: Vote },
];

function findActionDate(bill: Bill, match: RegExp) {
  const action = bill.actions.find((item) => match.test(item.label) || match.test(item.detail));
  return action?.date;
}

export function BillProgressStepper({ bill }: { bill: Bill }) {
  const current = STATUS_ORDER[bill.status] ?? 0;
  const failed = bill.status === "Failed";

  return (
    <div>
      <div className="flex items-start overflow-x-auto pb-1 pt-1.5">
        {MILESTONES.map((milestone, index) => {
          const reached = !failed && current >= milestone.reachedAt;
          const isCurrent =
            reached
            && (index === MILESTONES.length - 1 || current < MILESTONES[index + 1].reachedAt);
          const done = reached && !isCurrent;
          const date = reached ? findActionDate(bill, milestone.match) : undefined;
          const Icon = milestone.icon;

          return (
            <div
              key={milestone.label}
              className={cn(
                "relative flex min-w-[94px] flex-1 flex-col items-center gap-2 text-center",
                // Connector to the previous step, drawn behind the dot.
                "before:absolute before:top-[15px] before:left-[calc(-50%_+_16px)] before:right-[calc(50%_+_16px)] before:h-0.5 before:bg-[var(--line-2)] before:content-['']",
                "first:before:hidden",
                reached && "before:bg-[rgba(99,102,241,0.5)]",
              )}
            >
              <span
                className={cn(
                  "z-[1] grid h-8 w-8 place-items-center rounded-full border [&>svg]:h-3.5 [&>svg]:w-3.5",
                  done && "border-[var(--accent)] bg-[var(--accent)] text-white",
                  isCurrent && "border-[var(--success)] bg-[var(--success)] text-[#04140d]",
                  !reached && "border-[var(--line-2)] bg-[var(--panel-3)] text-[var(--faint)]",
                )}
              >
                <Icon />
              </span>
              <span
                className={cn(
                  "text-xs font-medium leading-tight",
                  reached ? "text-[var(--ink)]" : "text-[var(--faint)]",
                )}
              >
                {milestone.label}
              </span>
              <span
                className={cn(
                  "num text-[11px]",
                  isCurrent ? "font-semibold text-[var(--success)]" : "text-[var(--faint)]",
                )}
              >
                {date || (reached ? "Reached" : "—")}
              </span>
            </div>
          );
        })}
      </div>
      {failed ? (
        <p className="mt-4 rounded-[var(--r-sm)] bg-[var(--danger-soft)] px-3.5 py-2 text-[13px] font-semibold text-[var(--danger)]">
          This measure failed and did not advance.
        </p>
      ) : null}
    </div>
  );
}
