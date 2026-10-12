"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
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
 * Recharts writes these straight into SVG attributes, where a var() reference is not reliably
 * resolved, so the theme tokens have to be repeated here as literals. These constants keep every
 * chart in the app reading against --panel rather than each one drifting.
 */
const GRID = "rgba(27,26,23,0.1)";
const AXIS_TICK = { fill: "#5f5b52", fontSize: 11 };

const TOOLTIP_PROPS = {
  contentStyle: {
    background: "#ffffff",
    border: "1px solid rgba(27,26,23,0.14)",
    borderRadius: 8,
    fontSize: 12,
    color: "#1b1a17",
    boxShadow: "0 8px 24px rgba(27,26,23,0.12)",
  },
  labelStyle: { color: "#5f5b52", marginBottom: 2 },
  itemStyle: { color: "#1b1a17" },
  cursor: { fill: "rgba(27,26,23,0.05)" },
} as const;

/*
 * The categorical series colors, in assignment order: indigo, emerald, amber, sky, rose. That
 * order is not arbitrary -- it is the one ordering of these five that clears a colorblind
 * separation check against the white panel, so a chart that takes tones in order stays readable.
 * Keep emerald and rose non-adjacent if you add a slot.
 *
 * `slate` is the deliberate neutral ("everything else"), not a sixth category, and the party
 * tones mirror --party-* because their meaning is fixed.
 */
const CHART_COLOR: Record<Tone, string> = {
  indigo: "#4338ca",
  emerald: "#047857",
  amber: "#b45309",
  sky: "#0369a1",
  rose: "#be123c",
  slate: "#6b7280",
  "party-d": "#1d4ed8",
  "party-r": "#b91c1c",
  "party-i": "#6b4ea8",
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
        {/* Without a legend the slices were unlabelled until hovered. */}
        <Legend
          verticalAlign="bottom"
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: "#5f5b52" }}
          formatter={(label) => {
            const value = data.find((entry) => entry.label === label)?.value;
            return value === undefined ? label : `${label} · ${value.toLocaleString()}`;
          }}
        />
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
