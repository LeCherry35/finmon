export const dynamic = "force-dynamic";

import {
  getPlansForMonth,
  getPlansSummary,
  getCategories,
  getAvailableMonths,
} from "@/db/queries";
import { requireUser } from "@/lib/dal";
import PlanRow from "@/components/PlanRow";
import FilterPanel from "@/components/FilterPanel";
import {
  parseFilters,
  resolveFilters,
  formatMonthLabel,
} from "@/lib/filters";

export default async function PlanPage(props: PageProps<"/plan">) {
  const { id: userId } = await requireUser();
  const sp = await props.searchParams;
  const filters = parseFilters(sp);

  const [categories, availableMonths] = await Promise.all([
    getCategories(userId),
    getAvailableMonths(userId),
  ]);

  const resolved = resolveFilters(filters);

  const isSingleMonth = resolved.months.length === 1;
  const headerLabel =
    resolved.months.length === 0
      ? "No month selected"
      : resolved.months
          .slice()
          .sort()
          .reverse()
          .map(formatMonthLabel)
          .join(" + ");

  return (
    <div className="max-w-xl mx-auto py-6 px-4 space-y-6 md:py-10">
      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
        <h1 className="text-xl font-semibold">Plan — {headerLabel}</h1>
        <FilterPanel
          availableMonths={availableMonths}
          categories={categories}
          selected={filters}
        />
      </div>

      {!isSingleMonth && resolved.months.length > 0 && (
        <p className="text-xs text-zinc-400">
          Editing available when a single month is selected.
        </p>
      )}

      {categories.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No categories yet —{" "}
          <a href="/categories" className="underline">
            add one first
          </a>
        </p>
      ) : isSingleMonth ? (
        <SingleMonthPlan
          userId={userId}
          month={resolved.months[0]}
          categoryIds={resolved.categoryIds}
        />
      ) : (
        <MultiMonthPlan
          userId={userId}
          months={resolved.months}
          categoryIds={resolved.categoryIds}
        />
      )}
    </div>
  );
}

async function SingleMonthPlan({
  userId,
  month,
  categoryIds,
}: {
  userId: string;
  month: string;
  categoryIds: number[] | null;
}) {
  const rows = await getPlansForMonth(userId, month, categoryIds);
  const total = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  // Count spend from every category, including those with no plan (treated as a
  // plan of 0) — otherwise spend against an unplanned category vanishes.
  const totalSpent = rows.reduce((sum, r) => sum + Number(r.spent), 0);
  const totalLeft = total - totalSpent;

  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-zinc-500 border-b border-zinc-200">
          <th className="pb-2 pr-4 text-sm font-medium">Category</th>
          <th className="pb-2 px-4 text-sm font-medium text-right">Left</th>
          <th className="pb-2 text-sm font-medium text-right">Planned</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <PlanRow key={row.category_id} row={row} month={month} />
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-zinc-300">
          <td className="pt-2 pr-4 text-sm font-semibold">Total</td>
          <td className={`pt-2 px-4 text-sm font-semibold text-right ${totalLeft >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {totalLeft.toFixed(2)}
          </td>
          <td className="pt-2 text-sm font-semibold text-right">{total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

async function MultiMonthPlan({
  userId,
  months,
  categoryIds,
}: {
  userId: string;
  months: string[];
  categoryIds: number[] | null;
}) {
  if (months.length === 0) {
    return (
      <p className="text-sm text-zinc-400">
        Select at least one month to see plan totals.
      </p>
    );
  }
  const rows = await getPlansSummary(userId, months, categoryIds);
  const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const totalSpent = rows.reduce((sum, r) => sum + Number(r.spent), 0);
  const totalLeft = total - totalSpent;

  return (
    <table className="w-full">
      <thead>
        <tr className="text-left text-zinc-500 border-b border-zinc-200">
          <th className="pb-2 pr-4 text-sm font-medium">Category</th>
          <th className="pb-2 px-4 text-sm font-medium text-right">Left</th>
          <th className="pb-2 text-sm font-medium text-right">Planned</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          // No plan across the selected months counts as 0, so spend still
          // shows as a negative "left".
          const planned = Number(row.amount);
          const spent = Number(row.spent);
          const left = planned - spent;
          return (
            <tr key={row.category_id} className="border-b border-zinc-100">
              <td className="py-2 pr-4 text-sm">{row.category_name}</td>
              <td className="py-2 px-4 text-sm text-right">
                <span className={left >= 0 ? "text-emerald-600" : "text-red-500"}>
                  {left.toFixed(2)}
                </span>
              </td>
              <td className="py-2 text-sm text-right">{planned.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-zinc-300">
          <td className="pt-2 pr-4 text-sm font-semibold">Total</td>
          <td className={`pt-2 px-4 text-sm font-semibold text-right ${totalLeft >= 0 ? "text-emerald-600" : "text-red-500"}`}>
            {totalLeft.toFixed(2)}
          </td>
          <td className="pt-2 text-sm font-semibold text-right">{total.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
