"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Category } from "@/actions/categories";
import type { SeriesPoint } from "@/lib/chartData";
import {
  type Bucket,
  categoryColor,
  formatBucketLabel,
} from "@/lib/charts";

type Props = {
  data: SeriesPoint[];
  categories: Category[];
  monthBoundaries: string[];
  bucket: Bucket;
};

export default function ExpendituresOverTime({
  data,
  categories,
  monthBoundaries,
  bucket,
}: Props) {
  if (categories.length === 0) {
    return (
      <Empty msg="No categories selected — pick at least one in the filter." />
    );
  }
  if (data.length === 0) {
    return (
      <Empty msg="No months selected — pick at least one in the filter." />
    );
  }

  return (
    <div className="space-y-3">
      <div className="w-full" style={{ height: 380 }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke="#e4e4e7" vertical={false} />
            <XAxis
              dataKey="bucket"
              tickFormatter={(k) => formatBucketLabel(k, bucket)}
              minTickGap={36}
              tickLine={false}
              axisLine={{ stroke: "#a1a1aa" }}
              tick={{ fill: "#71717a", fontSize: 10 }}
            />
            <YAxis
              tickFormatter={formatTick}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "#a1a1aa", fontSize: 10 }}
              width={48}
            />
            {monthBoundaries.map((b) => (
              <ReferenceLine
                key={b}
                x={b}
                stroke="#d4d4d8"
                strokeDasharray="3 3"
                ifOverflow="extendDomain"
              />
            ))}
            <Tooltip
              cursor={{ stroke: "#71717a", strokeWidth: 1 }}
              content={({ active, payload, label }) => (
                <CrosshairTooltip
                  active={active}
                  payload={payload}
                  label={typeof label === "string" ? label : undefined}
                  categories={categories}
                  bucket={bucket}
                />
              )}
            />
            {categories.map((c) => {
              const { fill, stroke } = categoryColor(c.id);
              return (
                <Area
                  key={c.id}
                  type="linear"
                  stackId="spend"
                  dataKey={c.name}
                  stroke={stroke}
                  fill={fill}
                  strokeWidth={1}
                  isAnimationActive={false}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <Legend categories={categories} />
    </div>
  );
}

type TooltipItem = {
  value?: number | string | readonly (number | string)[];
  dataKey?: string | number | ((obj: unknown) => unknown);
  name?: string | number;
};

function CrosshairTooltip({
  active,
  payload,
  label,
  categories,
  bucket,
}: {
  active?: boolean;
  payload?: readonly TooltipItem[];
  label?: string;
  categories: Category[];
  bucket: Bucket;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const valueByName = new Map<string, number>();
  for (const item of payload) {
    const key =
      typeof item.dataKey === "string"
        ? item.dataKey
        : typeof item.dataKey === "number"
          ? String(item.dataKey)
          : null;
    if (typeof item.value === "number" && key !== null) {
      valueByName.set(key, item.value);
    }
  }
  const total = Array.from(valueByName.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-lg text-xs">
      <div className="px-3 py-2 border-b border-zinc-100 font-medium text-zinc-700">
        {label ? formatBucketLabel(label, bucket) : ""}
      </div>
      <ul className="px-3 py-2 space-y-1">
        {categories.map((c) => {
          const v = valueByName.get(c.name) ?? 0;
          const color = categoryColor(c.id);
          return (
            <li
              key={c.id}
              className="flex items-center justify-between gap-4 text-zinc-600"
            >
              <span className="inline-flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm border"
                  style={{ background: color.fill, borderColor: color.stroke }}
                />
                {c.name}
              </span>
              <span className="tabular-nums">{v.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
      <div className="px-3 py-2 border-t border-zinc-100 flex items-center justify-between gap-4 text-zinc-800 font-medium">
        <span>Total</span>
        <span className="tabular-nums">{total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function Legend({ categories }: { categories: Category[] }) {
  if (categories.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
      {categories.map((c) => {
        const color = categoryColor(c.id);
        return (
          <li key={c.id} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm border"
              style={{ background: color.fill, borderColor: color.stroke }}
            />
            <span>{c.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="border border-dashed border-zinc-200 rounded-md py-16 text-center text-sm text-zinc-400">
      {msg}
    </div>
  );
}

function formatTick(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return v.toFixed(0);
}
