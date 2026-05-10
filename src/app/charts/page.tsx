export const dynamic = "force-dynamic";

import {
  getCategories,
  getAvailableMonths,
  getExpenditureSeries,
} from "@/db/queries";
import FilterPanel from "@/components/FilterPanel";
import ChartTabs from "@/components/charts/ChartTabs";
import {
  CHARTS,
  DEFAULT_CHART,
  type ChartId,
} from "@/components/charts/registry";
import ExpendituresOverTime from "@/components/charts/ExpendituresOverTime";
import { parseFilters, resolveFilters } from "@/lib/filters";
import { generateBuckets, pickBucket } from "@/lib/charts";
import {
  monthTransitionBuckets,
  pivotForRecharts,
} from "@/lib/chartData";

function readChartId(value: string | string[] | undefined): ChartId {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && CHARTS.some((c) => c.id === raw)) return raw as ChartId;
  return DEFAULT_CHART;
}

export default async function ChartsPage(props: PageProps<"/charts">) {
  const sp = await props.searchParams;
  const filters = parseFilters(sp);
  const chart = readChartId(sp.chart);

  const [categories, availableMonths] = await Promise.all([
    getCategories(),
    getAvailableMonths(),
  ]);

  const resolved = resolveFilters(filters);
  const visibleCategoryIds =
    resolved.categoryIds ?? categories.map((c) => c.id);
  const visibleCategories = categories.filter((c) =>
    visibleCategoryIds.includes(c.id),
  );

  const bucket = pickBucket(resolved.months);
  const buckets = generateBuckets(resolved.months, bucket);

  const orderedCategories = [...visibleCategories].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );

  const rows =
    orderedCategories.length === 0
      ? []
      : await getExpenditureSeries(
          resolved.months,
          resolved.categoryIds,
          bucket,
        );

  const data = pivotForRecharts(buckets, orderedCategories, rows);
  const monthBoundaries = monthTransitionBuckets(buckets);

  return (
    <div className="max-w-5xl mx-auto py-10 px-4 space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Charts</h1>
        <FilterPanel
          availableMonths={availableMonths}
          categories={categories}
          selected={filters}
        />
      </div>

      <ChartTabs current={chart} />

      {chart === "expenditures-over-time" && (
        <ExpendituresOverTime
          data={data}
          categories={orderedCategories}
          monthBoundaries={monthBoundaries}
          bucket={bucket}
        />
      )}
    </div>
  );
}
