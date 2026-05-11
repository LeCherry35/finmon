"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateTransaction, deleteTransaction } from "@/actions/transactions";
import type { Transaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";

const MOBILE_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatMobileDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return MOBILE_DATE_FMT.format(new Date(y, m - 1, d));
}

export default function TransactionRow({
  tx,
  categories,
}: {
  tx: Transaction;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState(String(tx.amount));
  const [type, setType] = useState(tx.type);
  const [categoryId, setCategoryId] = useState(String(tx.category_id));
  const [date, setDate] = useState(tx.date);
  const [note, setNote] = useState(tx.note ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      fd.append("amount", amount);
      fd.append("type", type);
      fd.append("category_id", categoryId);
      fd.append("date", date);
      fd.append("note", note);
      const res = await updateTransaction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  function handleCancel() {
    setAmount(String(tx.amount));
    setType(tx.type);
    setCategoryId(String(tx.category_id));
    setDate(tx.date);
    setNote(tx.note ?? "");
    setError(null);
    setEditing(false);
  }

  function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      await deleteTransaction(fd);
    });
  }

  const inputCls =
    "border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400";

  const amountClass =
    tx.type === "income" ? "text-emerald-600" : "text-red-500";
  const amountText = `${tx.type === "income" ? "+" : "-"}${tx.amount.toFixed(2)}`;

  return (
    <>
      {/* MOBILE row — single-cell card */}
      <tr className="md:hidden">
        <td colSpan={5} className="p-0">
          <MobileCard
            tx={tx}
            categories={categories}
            editing={editing}
            setEditing={setEditing}
            expanded={expanded}
            setExpanded={setExpanded}
            amount={amount}
            setAmount={setAmount}
            type={type}
            setType={setType}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            date={date}
            setDate={setDate}
            note={note}
            setNote={setNote}
            isPending={isPending}
            error={error}
            confirmDelete={confirmDelete}
            onSave={handleSave}
            onCancel={handleCancel}
            onDelete={handleDelete}
            amountClass={amountClass}
            amountText={amountText}
          />
        </td>
      </tr>

      {/* DESKTOP row */}
      {editing ? (
        <>
          <tr
            className={`hidden md:table-row ${
              error ? "" : "border-b border-zinc-100"
            }`}
          >
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
          {error && (
            <tr className="hidden md:table-row border-b border-zinc-100">
              <td colSpan={5} className="pb-2 text-xs text-red-600">
                {error}
              </td>
            </tr>
          )}
        </>
      ) : (
        <tr className="hidden md:table-row border-b border-zinc-100">
          <td className="py-2 pr-2 text-sm text-zinc-500">{tx.date}</td>
          <td className="py-2 pr-2 text-sm">{tx.category_name}</td>
          <td
            className={`py-2 pr-2 text-sm font-mono ${amountClass}`}
          >
            {amountText}
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
                title={confirmDelete ? "Click again to confirm" : "Delete"}
                className={`disabled:opacity-40 ${
                  confirmDelete
                    ? "text-red-500 hover:text-red-700"
                    : "text-zinc-400 hover:text-red-500"
                }`}
              >
                <TrashIcon />
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function MobileCard({
  tx,
  categories,
  editing,
  setEditing,
  expanded,
  setExpanded,
  amount,
  setAmount,
  type,
  setType,
  categoryId,
  setCategoryId,
  date,
  setDate,
  note,
  setNote,
  isPending,
  error,
  confirmDelete,
  onSave,
  onCancel,
  onDelete,
  amountClass,
  amountText,
}: {
  tx: Transaction;
  categories: Category[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  amount: string;
  setAmount: (v: string) => void;
  type: Transaction["type"];
  setType: (v: Transaction["type"]) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  date: string;
  setDate: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  isPending: boolean;
  error: string | null;
  confirmDelete: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  amountClass: string;
  amountText: string;
}) {
  const sheetInputCls =
    "border border-zinc-300 rounded px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-zinc-400";

  if (editing) {
    return (
      <div className="border-b border-zinc-100 py-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className={sheetInputCls}
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as Transaction["type"])}
            className={sheetInputCls}
          >
            <option value="spend">Spend</option>
            <option value="income">Income</option>
          </select>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className={sheetInputCls}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={sheetInputCls}
          />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className={`w-full ${sheetInputCls}`}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 min-h-11 rounded border border-zinc-300 text-sm text-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={isPending}
            className="flex-1 min-h-11 rounded bg-zinc-900 text-white text-sm disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-100">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full text-left flex items-center justify-between gap-3 py-3 min-h-12"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{tx.category_name}</div>
          <div className="text-[11px] text-zinc-400">{formatMobileDate(tx.date)}</div>
        </div>
        <div className={`text-sm font-mono shrink-0 ${amountClass}`}>{amountText}</div>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && (
        <div className="pb-3 space-y-3">
          <div className="text-sm text-zinc-500">
            <span className="text-zinc-400">Note: </span>
            {tx.note ?? "—"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 min-h-11 rounded border border-zinc-300 text-sm text-zinc-700 flex items-center justify-center gap-2"
            >
              <PencilIcon />
              Edit
            </button>
            <button
              onClick={onDelete}
              disabled={isPending}
              className={`flex-1 min-h-11 rounded border text-sm flex items-center justify-center gap-2 disabled:opacity-40 ${
                confirmDelete
                  ? "border-red-500 text-red-600 bg-red-50"
                  : "border-zinc-300 text-zinc-700"
              }`}
            >
              <TrashIcon />
              {confirmDelete ? "Tap again" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </div>
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`text-zinc-400 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
