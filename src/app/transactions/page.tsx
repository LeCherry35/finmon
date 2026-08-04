export const dynamic = "force-dynamic";

import {
  getTransactions,
  getCategories,
  getAvailableMonths,
} from "@/db/queries";
import { requireUser } from "@/lib/dal";
import TransactionRow from "@/components/TransactionRow";
import TransactionCreateForm from "@/components/TransactionCreateForm";
import TransactionCreateSheet from "@/components/TransactionCreateSheet";
import FilterPanel from "@/components/FilterPanel";
import SortToggle from "@/components/SortToggle";
import type { TransactionSort } from "@/db/queries";
import { parseFilters, resolveFilters } from "@/lib/filters";

export default async function TransactionsPage(
  props: PageProps<"/transactions">,
) {
  const { id: userId } = await requireUser();
  const sp = await props.searchParams;
  const filters = parseFilters(sp);

  const [categories, availableMonths] = await Promise.all([
    getCategories(userId),
    getAvailableMonths(userId),
  ]);

  const resolved = resolveFilters(filters);
  const sort: TransactionSort = sp.sort === "added" ? "added" : "date";

  const transactions = await getTransactions(
    userId,
    {
      months: resolved.months,
      categoryIds: resolved.categoryIds,
    },
    sort,
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6 md:py-10 md:space-y-8">
      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <FilterPanel
          availableMonths={availableMonths}
          categories={categories}
          selected={filters}
        />
        <SortToggle sort={sort} />
      </div>

      <TransactionCreateForm categories={categories} today={today} />
      <TransactionCreateSheet categories={categories} today={today} />

      <table className="w-full table-auto md:table-fixed">
        <colgroup>
          <col className="w-28" />
          <col />
          <col className="w-32" />
          <col className="w-36" />
          <col className="w-28" />
          <col className="w-16" />
        </colgroup>
        <thead className="hidden md:table-header-group">
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 pr-2 text-sm font-medium">Date</th>
            <th className="pb-2 pr-2 text-sm font-medium">Category</th>
            <th className="pb-2 pr-2 text-sm font-medium">Store</th>
            <th className="pb-2 pr-2 text-sm font-medium">Status</th>
            <th className="pb-2 pr-2 text-sm font-medium">Amount</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} categories={categories} />
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={6} className="py-4 text-center text-zinc-400 text-sm">
                No transactions match the current filters
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
