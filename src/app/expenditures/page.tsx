export const dynamic = "force-dynamic";

import { getExpendituresByCategory } from "@/db/queries";

export default async function ExpendituresPage() {
  const rows = await getExpendituresByCategory();
  const grandTotal = rows.reduce((sum, r) => sum + r.total, 0);

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Expenditures by Category</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">No spend transactions yet.</p>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="text-left text-zinc-500 border-b border-zinc-200">
              <th className="pb-2 pr-4 text-sm font-medium">Category</th>
              <th className="pb-2 pr-4 text-sm font-medium text-right">Transactions</th>
              <th className="pb-2 text-sm font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.category_name} className="border-b border-zinc-100">
                <td className="py-2 pr-4 text-sm">{row.category_name}</td>
                <td className="py-2 pr-4 text-sm text-right text-zinc-500">{row.count}</td>
                <td className="py-2 text-sm text-right text-red-600">
                  {row.total.toFixed(2)}
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
