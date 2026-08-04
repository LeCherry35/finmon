export const dynamic = "force-dynamic";

import {
  getCategories,
  getAvailableMonths,
  getExpenditureSeries,
  getExpendituresByCategory,
} from "@/db/queries";
import { UNCATEGORIZED_ID, UNCATEGORIZED_NAME } from "@/lib/categories";
import type { Category } from "@/actions/categories";
import { requireUser } from "@/lib/dal";
import FilterPanel from "@/components/FilterPanel";
import ChartTabs from "@/components/charts/ChartTabs";
import {
  CHARTS,
  DEFAULT_CHART,
  type ChartId,
} from "@/components/charts/registry";
import ExpendituresOverTime from "@/components/charts/ExpendituresOverTime";
import CategoryShare from "@/components/charts/CategoryShare";
import { parseFilters, resolveFilters } from "@/lib/filters";
import { contiguousMonthRange, generateBuckets, pickBucket } from "@/lib/charts";
import {
  monthTransitionBuckets,
  pivotForRecharts,
} from "@/lib/chartData";

// Synthetic category for the "Uncategorized" spend bucket the aggregation
// queries emit (id 0). Appended to the real category list so the pivot, colors
// and legend treat it like any other series. priority -1 keeps it last.
const UNCATEGORIZED_CATEGORY: Category = {
  id: UNCATEGORIZED_ID,
  name: UNCATEGORIZED_NAME,
  priority: -1,
};

function readChartId(value: string | string[] | undefined): ChartId {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw && CHARTS.some((c) => c.id === raw)) return raw as ChartId;
  return DEFAULT_CHART;
}

export default async function ChartsPage(props: PageProps<"/charts">) {
  const { id: userId } = await requireUser();
  const sp = await props.searchParams;
  const filters = parseFilters(sp);
  const chart = readChartId(sp.chart);

  const [categories, availableMonths] = await Promise.all([
    getCategories(userId),
    getAvailableMonths(userId),
  ]);

  const resolved = resolveFilters(filters);
  const visibleCategoryIds =
    resolved.categoryIds ?? categories.map((c) => c.id);
  const visibleCategories = categories.filter((c) =>
    visibleCategoryIds.includes(c.id),
  );

  const orderedCategories = [...visibleCategories].sort(
    (a, b) => b.priority - a.priority || a.name.localeCompare(b.name),
  );

  return (
    <div className="max-w-5xl mx-auto py-6 px-4 space-y-6 md:py-10">
      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
        <h1 className="text-xl font-semibold">Charts</h1>
        <FilterPanel
          availableMonths={availableMonths}
          categories={categories}
          selected={filters}
        />
      </div>

      <ChartTabs current={chart} />

      {chart === "expenditures-over-time" && (
        <ExpendituresOverTimePanel
          userId={userId}
          months={resolved.months}
          categoryIds={resolved.categoryIds}
          orderedCategories={orderedCategories}
        />
      )}

      {chart === "category-share" && (
        <CategorySharePanel
          userId={userId}
          months={resolved.months}
          categoryIds={resolved.categoryIds}
          orderedCategories={orderedCategories}
        />
      )}
    </div>
  );
}

async function ExpendituresOverTimePanel({
  userId,
  months,
  categoryIds,
  orderedCategories,
}: {
  userId: string;
  months: string[];
  categoryIds: number[] | null;
  orderedCategories: Awaited<ReturnType<typeof getCategories>>;
}) {
  // Plot a continuous timeline: a non-adjacent month selection (e.g. Jan + Mar)
  // is filled in to its full span (Jan–Mar) so the x-axis doesn't stitch the
  // gap shut. The query reads the same span so intervening months show real data.
  const spanMonths = contiguousMonthRange(months);
  const bucket = pickBucket(spanMonths);
  const buckets = generateBuckets(spanMonths, bucket);

  // Uncategorized spend (id 0) is only returned when no category filter is
  // active — fetch when there are real categories to show OR uncategorized is
  // in scope, so a user whose only spend is uncategorized still sees a chart.
  const uncategorizedInScope = categoryIds === null;
  const rows =
    orderedCategories.length === 0 && !uncategorizedInScope
      ? []
      : await getExpenditureSeries(userId, spanMonths, categoryIds, bucket);

  const chartCategories = rows.some((r) => r.category_id === UNCATEGORIZED_ID)
    ? [...orderedCategories, UNCATEGORIZED_CATEGORY]
    : orderedCategories;

  const data = pivotForRecharts(buckets, chartCategories, rows);
  const monthBoundaries = monthTransitionBuckets(buckets);

  return (
    <ExpendituresOverTime
      data={data}
      categories={chartCategories}
      monthBoundaries={monthBoundaries}
      bucket={bucket}
    />
  );
}

async function CategorySharePanel({
  userId,
  months,
  categoryIds,
  orderedCategories,
}: {
  userId: string;
  months: string[];
  categoryIds: number[] | null;
  orderedCategories: Awaited<ReturnType<typeof getCategories>>;
}) {
  const uncategorizedInScope = categoryIds === null;
  const rows =
    orderedCategories.length === 0 && !uncategorizedInScope
      ? []
      : await getExpendituresByCategory(userId, { months, categoryIds });

  // CategoryShare builds slices from `rows` (so the Uncategorized slice appears
  // automatically); the category list is only its empty-state guard — include
  // the synthetic one so a user with only uncategorized spend isn't shown "no
  // categories selected".
  const chartCategories = rows.some((r) => r.category_id === UNCATEGORIZED_ID)
    ? [...orderedCategories, UNCATEGORIZED_CATEGORY]
    : orderedCategories;

  return <CategoryShare rows={rows} categories={chartCategories} />;
}
