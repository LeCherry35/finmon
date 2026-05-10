"use client";

import { useActionState } from "react";
import { createCategory } from "@/actions/categories";

export default function CategoryCreateForm() {
  const [state, formAction, pending] = useActionState(createCategory, {
    successCount: 0,
  });

  return (
    <form
      key={state.successCount}
      action={formAction}
      className="space-y-2"
    >
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
          disabled={pending}
          className="bg-zinc-800 text-white text-sm px-4 py-2 rounded hover:bg-zinc-700 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {state.error && (
        <p className="text-sm text-red-600">{state.error}</p>
      )}
    </form>
  );
}
