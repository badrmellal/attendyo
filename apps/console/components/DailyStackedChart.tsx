"use client";

/**
 * DailyStackedChart — present / late / absent per day, stacked (recharts).
 * Ultramarine = present, gold = late, rose-red = absent, matching the token
 * language used everywhere else. Data comes from `GET /api/reports/summary`.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ReportsDaily } from "@/lib/types";

function dayLabel(dateISO: string): string {
  const d = new Date(`${dateISO}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateISO;
  return new Intl.DateTimeFormat("fr-MA", { day: "2-digit", month: "short" }).format(d);
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: ReportsDaily }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 shadow-pop">
      <p className="text-xs font-medium text-text-muted">{dayLabel(p.date)}</p>
      <p className="tnum text-sm font-semibold text-primary">{p.present} présents</p>
      <p className="tnum text-sm font-semibold text-accent">{p.late} en retard</p>
      <p className="tnum text-sm font-semibold text-danger">{p.absent} absents</p>
    </div>
  );
}

export function DailyStackedChart({ data }: { data: ReportsDaily[] }) {
  // Beyond ~5 weeks, per-day ticks collapse into noise — thin the axis labels.
  const tickInterval = data.length > 35 ? Math.ceil(data.length / 18) : data.length > 14 ? 1 : 0;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap={4}>
          <CartesianGrid
            vertical={false}
            stroke="rgb(var(--border))"
            strokeOpacity={0.5}
            strokeDasharray="2 4"
          />
          <XAxis
            dataKey="date"
            tickFormatter={dayLabel}
            tick={{ fill: "rgb(var(--text-muted))", fontSize: 11 }}
            axisLine={{ stroke: "rgb(var(--border))" }}
            tickLine={false}
            interval={tickInterval}
          />
          <YAxis
            allowDecimals={false}
            width={32}
            tick={{ fill: "rgb(var(--text-muted))", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip cursor={{ fill: "rgb(var(--primary) / 0.06)" }} content={<ChartTooltip />} />
          <Legend
            formatter={(value: string) =>
              ({ present: "Présents", late: "En retard", absent: "Absents" })[value] ?? value
            }
            wrapperStyle={{ fontSize: 12, color: "rgb(var(--text-muted))" }}
            iconType="circle"
            iconSize={8}
          />
          <Bar dataKey="present" stackId="day" fill="rgb(var(--primary))" fillOpacity={0.9} maxBarSize={26} />
          <Bar dataKey="late" stackId="day" fill="rgb(var(--accent))" fillOpacity={0.9} maxBarSize={26} />
          <Bar
            dataKey="absent"
            stackId="day"
            fill="rgb(var(--danger))"
            fillOpacity={0.75}
            radius={[4, 4, 0, 0]}
            maxBarSize={26}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
