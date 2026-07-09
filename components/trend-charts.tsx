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

import { cn } from "@/lib/utils";

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
  const colorMap = {
    emerald: "#16a34a",
    amber: "#d97706",
    sky: "#0284c7",
    rose: "#e11d48",
  };

  return (
    <div className="rounded-[28px] border border-white/60 bg-[var(--panel)] p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-[var(--muted)]">{title}</p>
          <p className="mt-2 font-display text-3xl font-semibold text-[var(--ink)]">
            {value}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">{change}</p>
        </div>
        <div
          className={cn(
            "rounded-2xl p-3",
            tone === "emerald" && "bg-emerald-50 text-emerald-700",
            tone === "amber" && "bg-amber-50 text-amber-700",
            tone === "sky" && "bg-sky-50 text-sky-700",
            tone === "rose" && "bg-rose-50 text-rose-700",
          )}
        >
          {icon}
        </div>
      </div>
      <div className="mt-4 h-16">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <Tooltip cursor={false} />
            <Area
              type="monotone"
              dataKey="value"
              stroke={colorMap[tone]}
              strokeWidth={2}
              fill={`${colorMap[tone]}22`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendLineChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <CartesianGrid stroke="rgba(148,163,184,0.18)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={34} />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#2563eb"
          strokeWidth={3}
          dot={{ r: 4, fill: "#2563eb" }}
          activeDot={{ r: 5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function PartisanDonutChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  const colors = ["#2563eb", "#93c5fd", "#dbeafe"];

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
        >
          {data.map((entry, index) => (
            <Cell key={entry.label} fill={colors[index % colors.length]} />
          ))}
        </Pie>
        <Tooltip />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function VoteBarChart({
  data,
}: {
  data: Array<{ label: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data}>
        <CartesianGrid stroke="rgba(148,163,184,0.18)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={40} />
        <Tooltip />
        <Bar dataKey="value" radius={[12, 12, 0, 0]} fill="#1d4ed8" />
      </BarChart>
    </ResponsiveContainer>
  );
}
