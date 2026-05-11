"use client";

import { Cell, Label, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import type { Category } from "@/actions/categories";
import type { ExpenditureByCategory } from "@/db/queries";
import { categoryColor } from "@/lib/charts";

type Props = {
  rows: ExpenditureByCategory[];
  categories: Category[];
};

type Slice = {
  category_id: number;
  category_name: string;
  total: number;
};

export default function CategoryShare({ rows, categories }: Props) {
  if (categories.length === 0) {
    return (
      <Empty msg="No categories selected — pick at least one in the filter." />
    );
  }

  const slices: Slice[] = rows
    .map((r) => ({
      category_id: r.category_id,
      category_name: r.category_name,
      total: Number(r.total),
    }))
    .filter((s) => s.total > 0);

  if (slices.length === 0) {
    return (
      <Empty msg="No spend transactions match the current filters." />
    );
  }

  const total = slices.reduce((sum, s) => sum + s.total, 0);

  return (
    <div className="space-y-3">
      <div
        className="w-full h-72 md:h-[380px] relative [&_.recharts-wrapper]:outline-none [&_.recharts-surface]:outline-none"
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => (
                <SliceTooltip
                  active={active}
                  payload={payload as TooltipItem[] | undefined}
                  total={total}
                />
              )}
            />
            <Pie
              data={slices}
              dataKey="total"
              nameKey="category_name"
              cx="50%"
              cy="50%"
              innerRadius="37%"
              outerRadius="63%"
              stroke="#ffffff"
              strokeWidth={1}
              isAnimationActive={false}
              label={renderSliceLabel}
              labelLine={false}
            >
              {slices.map((s) => {
                const { fill, stroke } = categoryColor(s.category_id);
                return (
                  <Cell
                    key={s.category_id}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={1}
                  />
                );
              })}
              <Label
                position="center"
                content={({ viewBox }) => {
                  const vb = viewBox as
                    | {
                        cx?: number;
                        cy?: number;
                        x?: number;
                        y?: number;
                        width?: number;
                        height?: number;
                      }
                    | undefined;
                  const cx =
                    vb?.cx ??
                    (typeof vb?.x === "number" && typeof vb?.width === "number"
                      ? vb.x + vb.width / 2
                      : 0);
                  const cy =
                    vb?.cy ??
                    (typeof vb?.y === "number" && typeof vb?.height === "number"
                      ? vb.y + vb.height / 2
                      : 0);
                  return (
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                    >
                      <tspan
                        x={cx}
                        dy="-0.5em"
                        fontSize={10}
                        fill="#a1a1aa"
                        style={{ letterSpacing: "0.05em" }}
                      >
                        TOTAL
                      </tspan>
                      <tspan
                        x={cx}
                        dy="1.5em"
                        fontSize={18}
                        fontWeight={600}
                        fill="#27272a"
                      >
                        {total.toFixed(2)}
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      <Legend slices={slices} total={total} />
    </div>
  );
}

type SliceLabelProps = {
  cx?: number;
  cy?: number;
  midAngle?: number;
  innerRadius?: number;
  outerRadius?: number;
  percent?: number;
  value?: number;
};

function renderSliceLabel(props: SliceLabelProps) {
  const {
    cx = 0,
    cy = 0,
    midAngle = 0,
    innerRadius = 0,
    outerRadius = 0,
    percent = 0,
    value = 0,
  } = props;
  if (percent < 0.04) return null;
  const RAD = Math.PI / 180;
  const r = innerRadius + (outerRadius - innerRadius) * 0.55;
  const x = cx + r * Math.cos(-midAngle * RAD);
  const y = cy + r * Math.sin(-midAngle * RAD);
  return (
    <text
      x={x}
      y={y}
      fill="#3f3f46"
      fontSize={11}
      textAnchor="middle"
      dominantBaseline="central"
    >
      <tspan x={x} dy="-0.4em" fontWeight={500}>
        {`${(percent * 100).toFixed(0)}%`}
      </tspan>
      <tspan x={x} dy="1.1em" fontSize={10} fill="#52525b">
        {value.toFixed(2)}
      </tspan>
    </text>
  );
}

type TooltipItem = {
  name?: string | number;
  value?: number | string;
  payload?: Slice;
};

function SliceTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean;
  payload?: TooltipItem[];
  total: number;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  const slice = item.payload;
  if (!slice) return null;
  const value = slice.total;
  const pct = total > 0 ? (value / total) * 100 : 0;
  const color = categoryColor(slice.category_id);

  return (
    <div className="rounded-md border border-zinc-200 bg-white shadow-lg text-xs">
      <div className="px-3 py-2 border-b border-zinc-100 flex items-center gap-1.5 font-medium text-zinc-700">
        <span
          className="inline-block w-2.5 h-2.5 rounded-sm border"
          style={{ background: color.fill, borderColor: color.stroke }}
        />
        {slice.category_name}
      </div>
      <div className="px-3 py-2 space-y-1 text-zinc-600">
        <div className="flex items-center justify-between gap-4">
          <span>Spent</span>
          <span className="tabular-nums">{value.toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span>Share</span>
          <span className="tabular-nums">{pct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  );
}

function Legend({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600">
      {slices.map((s) => {
        const color = categoryColor(s.category_id);
        const pct = total > 0 ? (s.total / total) * 100 : 0;
        return (
          <li
            key={s.category_id}
            className="inline-flex items-center gap-1.5"
          >
            <span
              className="inline-block w-3 h-3 rounded-sm border"
              style={{ background: color.fill, borderColor: color.stroke }}
            />
            <span>{s.category_name}</span>
            <span className="text-zinc-400 tabular-nums">
              {pct.toFixed(1)}% · {s.total.toFixed(2)}
            </span>
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
