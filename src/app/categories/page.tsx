export const dynamic = "force-dynamic";

import { getCategories } from "@/db/queries";
import { createCategory } from "@/actions/categories";
import CategoryRow from "@/components/CategoryRow";

export default async function CategoriesPage() {
  const categories = await getCategories();

  return (
    <div className="max-w-xl mx-auto py-10 px-4 space-y-8">
      <h1 className="text-xl font-semibold">Categories</h1>

      <form action={createCategory} className="space-y-3">
        <div className="flex gap-3">
          <input
            name="name"
            required
            placeholder="Category name"
            className="flex-1 border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
          <input
            name="priority"
            type="number"
            min={0}
            max={10}
            defaultValue={5}
            required
            className="w-20 border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400"
            placeholder="0–10"
          />
          <button
            type="submit"
            className="bg-zinc-800 text-white text-sm px-4 py-2 rounded hover:bg-zinc-700"
          >
            Add
          </button>
        </div>
      </form>

      <table className="w-full">
        <thead>
          <tr className="text-left text-zinc-500 border-b border-zinc-200">
            <th className="pb-2 text-sm font-medium">Name</th>
            <th className="pb-2 text-sm font-medium w-24">Priority</th>
            <th className="pb-2 w-16" />
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <CategoryRow key={cat.id} category={cat} />
          ))}
          {categories.length === 0 && (
            <tr>
              <td colSpan={3} className="py-4 text-center text-zinc-400 text-sm">
                No categories yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
