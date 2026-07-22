"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { IconTile } from "@/components/ui/icon-tile";
import type { Tone } from "@/components/ui/tones";

/*
 * Recharts renders SVG with its own defaults tuned for a light background, so grid, axis, and
 * tooltip styling all have to be passed explicitly. These constants keep every chart in the app
 * reading against --panel rather than each one drifting.
 */
const GRID = "rgba(255,255,255,0.07)";
const AXIS_TICK = { fill: "#8b95ad", fontSize: 11 };

const TOOLTIP_PROPS = {
  contentStyle: {
    background: "#161d2e",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    fontSize: 12,
    color: "#e8edf7",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
  },
  labelStyle: { color: "#8b95ad", marginBottom: 2 },
  itemStyle: { color: "#e8edf7" },
  cursor: { fill: "rgba(255,255,255,0.04)" },
} as const;

const CHART_COLOR: Record<Tone, string> = {
  indigo: "#6366f1",
  emerald: "#34d399",
  sky: "#60a5fa",
  amber: "#fbbf24",
  rose: "#f87171",
  slate: "#5c6780",
  "party-d": "#3b82f6",
  "party-r": "#ef4444",
  "party-i": "#a78bfa",
};

export function SparklineCard({
  title,
  value,
  change,
  icon,
  data,
  tone,
}: {
  title: string;
  value: string;
  change: string;
  icon: React.ReactNode;
  data: Array<{ label: string; value: number }>;
  tone: "emerald" | "amber" | "sky" | "rose";
}) {
  const color = CHART_COLOR[tone];

  return (
    <div className="rounded-[var(--r-md)] border border-[var(--line)] bg-[var(--panel)] p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-[var(--muted)]">{title}</p>
          <p className="num mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-[var(--ink)]">
            {value}
          </p>
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--faint)]">{change}</p>
        </div>
        <IconTile tone={tone}>{icon}</IconTile>
      </div>
      <div className="mt-3 h-14">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Tooltip {...TOOLTIP_PROPS} cursor={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`${color}26`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendLineChart({ data }: { data: Array<{ label: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
        <YAxis tickLine={false} axisLine={false} width={34} tick={AXIS_TICK} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Line
          type="monotone"
          dataKey="value"
          stroke={CHART_COLOR.indigo}
          strokeWidth={2}
          dot={{ r: 3, fill: CHART_COLOR.indigo, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PartisanDonutChart({ data }: { data: Array<{ label: string; value: number }> }) {
  const colors = [CHART_COLOR.indigo, CHART_COLOR.sky, CHART_COLOR.slate];

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius={58}
          outerRadius={82}
          paddingAngle={3}
          stroke="none"
        >
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip {...TOOLTIP_PROPS} cursor={false} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VoteBarChart({ data }: { data: Array<{ label: string; value: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS_TICK} />
        <YAxis tickLine={false} axisLine={false} width={40} tick={AXIS_TICK} />
        <Tooltip {...TOOLTIP_PROPS} />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} fill={CHART_COLOR.indigo} />
      </BarChart>
    </ResponsiveContainer>
  );
}
