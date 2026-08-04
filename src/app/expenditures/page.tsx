export const dynamic = "force-dynamic";

import {
  getExpendituresByCategory,
  getCategories,
  getAvailableMonths,
} from "@/db/queries";
import { requireUser } from "@/lib/dal";
import FilterPanel from "@/components/FilterPanel";
import { parseFilters, resolveFilters } from "@/lib/filters";

export default async function ExpendituresPage(
  props: PageProps<"/expenditures">,
) {
  const { id: userId } = await requireUser();
  const sp = await props.searchParams;
  const filters = parseFilters(sp);

  const [categories, availableMonths] = await Promise.all([
    getCategories(userId),
    getAvailableMonths(userId),
  ]);

  const resolved = resolveFilters(filters);

  const rows = await getExpendituresByCategory(userId, {
    months: resolved.months,
    categoryIds: resolved.categoryIds,
  });
  const grandTotal = rows.reduce((sum, r) => sum + Number(r.total), 0);

  return (
    <div className="max-w-xl mx-auto py-6 px-4 space-y-6 md:py-10">
      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
        <h1 className="text-xl font-semibold">Expenditures by Category</h1>
        <FilterPanel
          availableMonths={availableMonths}
          categories={categories}
          selected={filters}
        />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No spend transactions match the current filters.
        </p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-200">
              <th className="pb-2 pr-4 text-sm font-medium">Category</th>
              <th className="pb-2 pr-4 text-sm font-medium text-right">
                <span className="md:hidden">Tx</span>
                <span className="hidden md:inline">Transactions</span>
              </th>
              <th className="pb-2 text-sm font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category_id} className="border-b border-zinc-100">
                <td className="py-2 pr-4 text-sm">{row.category_name}</td>
                <td className="py-2 pr-4 text-sm text-right text-zinc-500">{row.count}</td>
                <td className="py-2 text-sm text-right text-red-600">
                  {Number(row.total).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-zinc-300">
              <td className="pt-2 pr-4 text-sm font-semibold">Total</td>
              <td />
              <td className="pt-2 text-sm font-semibold text-right text-red-600">
                {grandTotal.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </div>
  );
}
