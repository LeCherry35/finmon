"use client";

import { useState, useTransition } from "react";
import { updateTransaction, deleteTransaction } from "@/actions/transactions";
import type { Transaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";

export default function TransactionRow({
  tx,
  categories,
}: {
  tx: Transaction;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(tx.amount));
  const [type, setType] = useState(tx.type);
  const [categoryId, setCategoryId] = useState(String(tx.category_id));
  const [date, setDate] = useState(tx.date);
  const [note, setNote] = useState(tx.note ?? "");
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      fd.append("amount", amount);
      fd.append("type", type);
      fd.append("category_id", categoryId);
      fd.append("date", date);
      fd.append("note", note);
      await updateTransaction(fd);
      setEditing(false);
    });
  }

  function handleCancel() {
    setAmount(String(tx.amount));
    setType(tx.type);
    setCategoryId(String(tx.category_id));
    setDate(tx.date);
    setNote(tx.note ?? "");
    setEditing(false);
  }

  function handleDelete() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      await deleteTransaction(fd);
    });
  }

  const inputCls =
    "border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400";

  if (editing) {
    return (
      <tr className="border-b border-zinc-100">
        <td className="py-2 pr-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={`${inputCls} w-34`}
          />
        </td>
        <td className="py-2 pr-2">
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={inputCls}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
        <td className="py-2 pr-2 text-right">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={`${inputCls} w-full text-center`}
          />
        </td>
        <td className="py-2 pr-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note"
            className={`${inputCls} w-full max-w-full`}
          />
        </td>
        <td className="py-2">
          <div className="flex gap-2 justify-end">
            <button
              onClick={handleSave}
              disabled={isPending}
              title="Save"
              className="text-emerald-600 hover:text-emerald-800 disabled:opacity-40"
            >
              <CheckIcon />
            </button>
            <button
              onClick={handleCancel}
              title="Cancel"
              className="text-zinc-400 hover:text-zinc-600"
            >
              <XIcon />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-zinc-100">
      <td className="py-2 pr-2 text-sm text-zinc-500">{tx.date}</td>
      <td className="py-2 pr-2 text-sm">{tx.category_name}</td>
      <td
        className={`py-2 pr-2 text-sm font-mono ${
          tx.type === "income" ? "text-emerald-600" : "text-red-500"
        }`}
      >
        {tx.type === "income" ? "+" : "-"}
        {tx.amount.toFixed(2)}
      </td>
      <td className="py-2 pr-2 text-sm text-zinc-400">{tx.note ?? "—"}</td>
      <td className="py-2">
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => setEditing(true)}
            title="Edit"
            className="text-zinc-400 hover:text-zinc-700"
          >
            <PencilIcon />
          </button>
          <button
            onClick={handleDelete}
            disabled={isPending}
            title="Delete"
            className="text-zinc-400 hover:text-red-500 disabled:opacity-40"
          >
            <TrashIcon />
          </button>
        </div>
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

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
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
