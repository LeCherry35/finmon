"use client";

import { useState, useTransition } from "react";
import { upsertPlan } from "@/actions/plans";
import type { PlanEntry } from "@/db/queries";

export default function PlanRow({
  row,
  month,
}: {
  row: PlanEntry;
  month: string;
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(row.amount != null ? String(row.amount) : "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("category_id", String(row.category_id));
      fd.append("month", month);
      fd.append("amount", amount);
      await upsertPlan(fd);
      setEditing(false);
    });
  }

  function handleCancel() {
    setAmount(row.amount != null ? String(row.amount) : "");
    setEditing(false);
  }

  const inputCls =
    "w-28 border border-zinc-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-zinc-400";

  const left = row.plan_id !== null ? (row.amount ?? 0) - row.spent : null;

  return (
    <tr className="border-b border-zinc-100">
      <td className="py-2 pr-4 text-sm">{row.category_name}</td>
      <td className="py-2 px-4 text-sm text-right">
        {left !== null ? (
          <span className={left >= 0 ? "text-emerald-600" : "text-red-500"}>
            {left.toFixed(2)}
          </span>
        ) : (
          <span className="text-zinc-300">—</span>
        )}
      </td>
      <td className="py-2 text-right">
        {editing || row.plan_id === null ? (
          <div className="flex justify-end items-center gap-2">
            <input
              type="number"
              step="0.01"
              min="0.01"
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
              className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
            >
              <CheckIcon />
            </button>
            {row.plan_id !== null && (
              <button
                onClick={handleCancel}
                title="Cancel"
                className="text-zinc-400 hover:text-zinc-600"
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
              className="text-zinc-400 hover:text-zinc-700"
            >
              <PencilIcon />
            </button>
          </div>
        )}
      </td>
    </tr>
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
