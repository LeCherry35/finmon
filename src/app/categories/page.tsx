export const dynamic = "force-dynamic";

import { getCategories } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import CategoryRow from "@/components/CategoryRow";
import CategoryCreateForm from "@/components/CategoryCreateForm";

export default async function CategoriesPage() {
  const { id: userId } = await requireUser();
  const categories = await getCategories(userId);

  return (
    <div className="max-w-xl mx-auto py-6 px-4 space-y-6 md:py-10 md:space-y-8">
      <h1 className="text-xl font-semibold">Categories</h1>

      <CategoryCreateForm />

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
