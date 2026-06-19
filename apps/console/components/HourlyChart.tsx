"use client";

/**
 * HourlyChart — entries-per-hour bar chart (recharts). Ultramarine bars on a quiet
 * grid, hairline axes, tabular tooltip. Kept presentational; data comes from
 * `GET /api/stats/today → hourly`.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Point = { hour: number; count: number };

function label(hour: number) {
  return `${String(hour).padStart(2, "0")}h`;
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
      <p className="text-xs font-medium text-text-muted">{label(p.hour)}</p>
      <p className="tnum text-sm font-semibold text-text">
        {p.count} {p.count === 1 ? "entrée" : "entrées"}
      </p>
    </div>
  );
}

export function HourlyChart({ data }: { data: Point[] }) {
  // Trim to working hours (06h–21h) for a cleaner, denser chart.
  const view = data.filter((d) => d.hour >= 6 && d.hour <= 21);
  const peak = view.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={view} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid
            vertical={false}
            stroke="rgb(var(--border))"
            strokeOpacity={0.5}
            strokeDasharray="2 4"
          />
          <XAxis
            dataKey="hour"
            tickFormatter={label}
            tick={{ fill: "rgb(var(--text-muted))", fontSize: 11 }}
            axisLine={{ stroke: "rgb(var(--border))" }}
            tickLine={false}
            interval={1}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tick={{ fill: "rgb(var(--text-muted))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgb(var(--primary) / 0.06)" }} content={<ChartTooltip />} />
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={26}>
            {view.map((d) => (
              <Cell
                key={d.hour}
                fill="rgb(var(--primary))"
                fillOpacity={peak > 0 ? 0.35 + (d.count / peak) * 0.65 : 0.5}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
