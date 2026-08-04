"use client";

import { useState, useTransition } from "react";
import { upsertPlan } from "@/actions/plans";
// Type-only from @/db/queries (erased at build); the runtime sentinel comes
// from @/lib/categories so `pg` never reaches the client bundle.
import type { PlanEntry } from "@/db/queries";
import { UNCATEGORIZED_ID } from "@/lib/categories";

export default function PlanRow({
  row,
  month,
}: {
  row: PlanEntry;
  month: string;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("category_id", String(row.category_id));
      fd.append("month", month);
      fd.append("amount", amount);
      const res = await upsertPlan(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  function handleCancel() {
    setAmount(row.amount != null ? String(row.amount) : "");
    setError(null);
    setEditing(false);
  }

  const inputCls =
    "w-24 md:w-28 border border-zinc-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-zinc-400";

  // An unset plan counts as 0, so spend against it still shows (as a negative
  // "left"). Matches the total on the plan page.
  const left = (row.amount ?? 0) - Number(row.spent);

  // The synthetic "Uncategorized" row (spend on transactions with no category):
  // its spend must count, but there's no category to attach a plan to, so it's
  // display-only — no amount input, no editing.
  const isUncategorized = row.category_id === UNCATEGORIZED_ID;

  return (
    <>
    <tr className={error ? "" : "border-b border-zinc-100"}>
      <td className="py-2 pr-4 text-sm">
        {isUncategorized ? (
          <span className="italic text-zinc-500">{row.category_name}</span>
        ) : (
          row.category_name
        )}
      </td>
      <td className="py-2 px-4 text-sm text-right">
        <span className={left >= 0 ? "text-emerald-600" : "text-red-500"}>
          {left.toFixed(2)}
        </span>
      </td>
      <td className="py-2 text-right">
        {isUncategorized ? (
          <span className="text-zinc-300">—</span>
        ) : editing || row.plan_id === null ? (
          <div className="flex justify-end items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className={inputCls}
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={isPending || !amount}
              title="Save"
              aria-label="Save"
              className="inline-flex items-center justify-center min-w-10 min-h-10 text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
            >
              <CheckIcon />
            </button>
            {row.plan_id !== null && (
              <button
                onClick={handleCancel}
                title="Cancel"
                aria-label="Cancel"
                className="inline-flex items-center justify-center min-w-10 min-h-10 text-zinc-400 hover:text-zinc-600"
              >
                <XIcon />
              </button>
            )}
          </div>
        ) : (
          <div className="flex justify-end items-center gap-3">
            <span className="text-sm">{row.amount!.toFixed(2)}</span>
            <button
              onClick={() => setEditing(true)}
              title="Change"
              aria-label="Change planned amount"
              className="inline-flex items-center justify-center min-w-10 min-h-10 text-zinc-400 hover:text-zinc-700"
            >
              <PencilIcon />
            </button>
          </div>
        )}
      </td>
    </tr>
    {error && (
      <tr className="border-b border-zinc-100">
        <td colSpan={3} className="pb-2 text-xs text-red-600 text-right">{error}</td>
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
