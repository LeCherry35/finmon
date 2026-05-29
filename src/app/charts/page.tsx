export const dynamic = "force-dynamic";

import {
  getCategories,
  getAvailableMonths,
  getExpenditureSeries,
  getExpendituresByCategory,
} from "@/db/queries";
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
  const bucket = pickBucket(months);
  const buckets = generateBuckets(months, bucket);

  const rows =
    orderedCategories.length === 0
      ? []
      : await getExpenditureSeries(userId, months, categoryIds, bucket);

  const data = pivotForRecharts(buckets, orderedCategories, rows);
  const monthBoundaries = monthTransitionBuckets(buckets);

  return (
    <ExpendituresOverTime
      data={data}
      categories={orderedCategories}
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
  const rows =
    orderedCategories.length === 0
      ? []
      : await getExpendituresByCategory(userId, { months, categoryIds });

  return <CategoryShare rows={rows} categories={orderedCategories} />;
}
