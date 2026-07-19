import {
  CircleDollarSign,
  HandCoins,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from "lucide-react";

import type { FundingGraphTotals } from "@/types/funding-graph";

function formatDollars(amount: number) {
  return `$${amount.toLocaleString()}`;
}

function percentageOf(part: number, whole: number) {
  if (whole <= 0) return null;
  return `${((part / whole) * 100).toFixed(1)}% of total`;
}

export function FundingStatTiles({ totals, cycleLabel }: { totals: FundingGraphTotals; cycleLabel: string }) {
  const tiles = [
    {
      label: "Total Receipts",
      value: formatDollars(totals.totalReceipts),
      detail: cycleLabel,
      icon: CircleDollarSign,
      color: "#16a34a",
      soft: "#dcfce7",
    },
    {
      label: "Individuals",
      value: formatDollars(totals.individualContributions),
      detail: percentageOf(totals.individualContributions, totals.totalReceipts) || "—",
      icon: User,
      color: "#2563eb",
      soft: "#dbeafe",
    },
    {
      label: "PACs",
      value: formatDollars(totals.pacContributions),
      detail: percentageOf(totals.pacContributions, totals.totalReceipts) || "—",
      icon: HandCoins,
      color: "#7c3aed",
      soft: "#ede9fe",
    },
    {
      label: "Small-Dollar %",
      value: `${totals.smallDollarPercentage}%`,
      detail: "<$200 contributions",
      icon: Users,
      color: "#0d9488",
      soft: "#ccfbf1",
    },
    {
      label: "Outside Support",
      value: formatDollars(totals.independentSupport),
      detail: "Independent expenditures",
      icon: TrendingUp,
      color: "#ea580c",
      soft: "#ffedd5",
    },
    {
      label: "Outside Oppose",
      value: formatDollars(totals.independentOpposition),
      detail: "Independent expenditures",
      icon: TrendingDown,
      color: "#dc2626",
      soft: "#fee2e2",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <div
            key={tile.label}
            className="rounded-[24px] border border-white/60 bg-[var(--panel)] p-4 shadow-[0_16px_44px_rgba(15,23,42,0.07)]"
          >
            <div className="flex items-center gap-2.5">
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: tile.soft }}
              >
                <Icon size={16} style={{ color: tile.color }} />
              </div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                {tile.label}
              </p>
            </div>
            <p className="mt-2.5 font-display text-2xl font-semibold text-[var(--ink)]">{tile.value}</p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">{tile.detail}</p>
          </div>
        );
      })}
    </div>
  );
}
