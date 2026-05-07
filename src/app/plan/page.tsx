export const dynamic = "force-dynamic";

import { getPlansForMonth } from "@/db/queries";
import PlanRow from "@/components/PlanRow";

export default async function PlanPage() {
  const month = new Date().toISOString().slice(0, 7);
  const rows = await getPlansForMonth(month);
  const total = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const totalSpent = rows.reduce((sum, r) => sum + (r.plan_id !== null ? r.spent : 0), 0);
  const totalLeft = total - totalSpent;

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-6">
      <h1 className="text-xl font-semibold">Plan — {month}</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-400">
          No categories yet —{" "}
          <a href="/categories" className="underline">
            add one first
          </a>
        </p>
      ) : (
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
              <PlanRow key={`${row.category_id}-${row.amount}`} row={row} month={month} />
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
      )}
    </div>
  );
}
