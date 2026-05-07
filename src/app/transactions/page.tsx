export const dynamic = "force-dynamic";

import { getTransactions, getCategories } from "@/db/queries";
import { createTransaction } from "@/actions/transactions";
import TransactionRow from "@/components/TransactionRow";

export default async function TransactionsPage() {
  const [transactions, categories] = await Promise.all([
    getTransactions(),
    getCategories(),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-xl font-semibold">Transactions</h1>

      <form action={createTransaction} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <input
            name="amount"
            type="number"
            step="0.01"
            min="0.01"
            required
            placeholder="Amount"
            className="border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <select
            name="type"
            required
            className="border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          >
            <option value="spend">Spend</option>
            <option value="income">Income</option>
          </select>
          <select
            name="category_id"
            required
            className="border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          >
            <option value="">Category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            name="date"
            type="date"
            defaultValue={today}
            required
            className="border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        </div>
        <div className="flex gap-3">
          <input
            name="note"
            placeholder="Note (optional)"
            className="flex-1 border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <button
            type="submit"
            className="bg-zinc-800 text-white text-sm px-4 py-2 rounded hover:bg-zinc-700"
          >
            Add
          </button>
        </div>
        {categories.length === 0 && (
          <p className="text-xs text-amber-600">
            No categories yet —{" "}
            <a href="/categories" className="underline">
              add one first
            </a>
          </p>
        )}
      </form>

      <table className="w-full table-fixed">
        <colgroup>
          <col className="w-28" />
          <col className="w-32" />
          <col className="w-28" />
          <col />
          <col className="w-16" />
        </colgroup>
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 pr-2 text-sm font-medium">Date</th>
            <th className="pb-2 pr-2 text-sm font-medium">Category</th>
            <th className="pb-2 pr-2 text-sm font-medium">Amount</th>
            <th className="pb-2 pr-2 text-sm font-medium">Note</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {transactions.map((tx) => (
            <TransactionRow key={tx.id} tx={tx} categories={categories} />
          ))}
          {transactions.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-zinc-400 text-sm">
                No transactions yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
