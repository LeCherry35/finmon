"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { deleteCategory } from "@/actions/categories";
import type { Category } from "@/actions/categories";

/** Confirmation for deleting a category, spelling out what moves and what
 *  goes. The counts come from the page (`getCategoryUsage`), so the dialog
 *  opens with the impact already known. */
export default function CategoryDeleteDialog({
  category,
  defaultName,
  transactions,
  plans,
  onClose,
}: {
  category: Category;
  /** Name of the user's default category — where the transactions land. */
  defaultName: string;
  transactions: number;
  plans: number;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(category.id));
      const res = await deleteCategory(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Delete ${category.name}`}
        className="relative z-10 w-full md:max-w-sm bg-white rounded-t-2xl md:rounded-2xl shadow-xl safe-pb"
      >
        <div className="px-4 py-3 border-b border-zinc-100">
          <h2 className="text-base font-semibold truncate">
            Delete &ldquo;{category.name}&rdquo;?
          </h2>
        </div>

        <div className="px-4 py-3 space-y-1 text-sm text-zinc-600">
          {transactions > 0 && (
            <p>
              {transactions} {transactions === 1 ? "transaction" : "transactions"} will move to{" "}
              <span className="font-medium text-zinc-800">{defaultName}</span>.
            </p>
          )}
          {plans > 0 && (
            <p>
              {plans} monthly {plans === 1 ? "plan" : "plans"} will be deleted.
            </p>
          )}
          {transactions === 0 && plans === 0 && <p>Nothing else uses this category.</p>}
          {error && <p className="text-red-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-100">
          <button
            onClick={onClose}
            className="text-sm px-4 py-2 rounded text-zinc-600 hover:bg-zinc-100"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="bg-red-600 text-white text-sm px-4 py-2 rounded hover:bg-red-500 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
