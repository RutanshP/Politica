import {
  CircleDollarSign,
  HandCoins,
  TrendingDown,
  TrendingUp,
  User,
  Users,
} from "lucide-react";

import { StatTile } from "@/components/ui/stat-tile";
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
      tone: "emerald" as const,
    },
    {
      label: "Individuals",
      value: formatDollars(totals.individualContributions),
      detail: percentageOf(totals.individualContributions, totals.totalReceipts) || "—",
      icon: User,
      tone: "sky" as const,
    },
    {
      label: "PACs",
      value: formatDollars(totals.pacContributions),
      detail: percentageOf(totals.pacContributions, totals.totalReceipts) || "—",
      icon: HandCoins,
      tone: "indigo" as const,
    },
    {
      label: "Small-Dollar %",
      value: `${totals.smallDollarPercentage}%`,
      detail: "<$200 contributions",
      icon: Users,
      tone: "emerald" as const,
    },
    {
      label: "Outside Support",
      value: formatDollars(totals.independentSupport),
      detail: "Independent expenditures",
      icon: TrendingUp,
      tone: "amber" as const,
    },
    {
      label: "Outside Oppose",
      value: formatDollars(totals.independentOpposition),
      detail: "Independent expenditures",
      icon: TrendingDown,
      tone: "rose" as const,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <StatTile
            key={tile.label}
            label={tile.label}
            value={tile.value}
            footnote={tile.detail}
            tone={tile.tone}
            icon={<Icon />}
          />
        );
      })}
    </div>
  );
}
