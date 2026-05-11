"use client";

import { useState, useTransition } from "react";
import { updateCategory } from "@/actions/categories";
import type { Category } from "@/actions/categories";

export default function CategoryRow({ category }: { category: Category }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [priority, setPriority] = useState(category.priority);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(category.id));
      fd.append("name", name);
      fd.append("priority", String(priority));
      const res = await updateCategory(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  function handleCancel() {
    setName(category.name);
    setPriority(category.priority);
    setError(null);
    setEditing(false);
  }

  return (
    <>
    <tr className={error ? "" : "border-b border-zinc-100"}>
      <td className="py-2 pr-4">
        {editing ? (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-40 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        ) : (
          <span className="text-sm">{name}</span>
        )}
      </td>
      <td className="py-2 pr-4 w-24">
        {editing ? (
          <input
            type="number"
            min={0}
            max={10}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            className="border border-zinc-300 rounded px-2 py-1 text-sm w-16 focus:outline-none focus:ring-1 focus:ring-zinc-400"
          />
        ) : (
          <span className="text-sm text-zinc-500">{priority}</span>
        )}
      </td>
      <td className="py-1 w-16">
        <div className="flex gap-1 justify-end">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={isPending}
                title="Save"
                aria-label="Save"
                className="inline-flex items-center justify-center min-w-10 min-h-10 text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
              >
                <CheckIcon />
              </button>
              <button
                onClick={handleCancel}
                title="Cancel"
                aria-label="Cancel"
                className="inline-flex items-center justify-center min-w-10 min-h-10 text-zinc-400 hover:text-zinc-600"
              >
                <XIcon />
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              title="Edit"
              aria-label="Edit"
              className="inline-flex items-center justify-center min-w-10 min-h-10 text-zinc-400 hover:text-zinc-700"
            >
              <PencilIcon />
            </button>
          )}
        </div>
      </td>
    </tr>
    {error && (
      <tr className="border-b border-zinc-100">
        <td colSpan={3} className="pb-2 text-xs text-red-600">{error}</td>
      </tr>
    )}
    </>
  );
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
