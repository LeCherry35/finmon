"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateTransaction, deleteTransaction, verifyTransaction } from "@/actions/transactions";
import type { Transaction, TransactionStatus } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import ProductsModal from "@/components/ProductsModal";

const STATUS_META: Record<TransactionStatus, { label: string; cls: string }> = {
  processing: { label: "Processing", cls: "bg-amber-100 text-amber-700" },
  unverified: { label: "Unverified", cls: "bg-zinc-100 text-zinc-600" },
  ready_to_verify: { label: "Ready to verify", cls: "bg-blue-100 text-blue-700" },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-700" },
};

function StatusBadge({ status }: { status: TransactionStatus }) {
  const { label, cls } = STATUS_META[status] ?? STATUS_META.unverified;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}

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
  const [showProducts, setShowProducts] = useState(false);
  const productCount = tx.products?.length ?? 0;
  const [amount, setAmount] = useState(String(tx.amount));
  const [type, setType] = useState(tx.type);
  const [categoryId, setCategoryId] = useState(String(tx.category_id));
  const [date, setDate] = useState(tx.date);
  const [note, setNote] = useState(tx.note ?? "");
  const [store, setStore] = useState(tx.store ?? "");
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
      fd.append("store", store);
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
    setStore(tx.store ?? "");
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

  function handleVerify() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      const res = await verifyTransaction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
    });
  }

  const canVerify = tx.status === "ready_to_verify";

  const inputCls =
    "border border-zinc-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400";

  const amountClass =
    tx.type === "income" ? "text-emerald-600" : "text-red-500";
  const amountText = `${tx.type === "income" ? "+" : "-"}${tx.amount.toFixed(2)}`;

  return (
    <>
      {/* MOBILE row — single-cell card */}
      <tr className="md:hidden">
        <td colSpan={6} className="p-0">
          <MobileCard
            tx={tx}
            categories={categories}
            editing={editing}
            setEditing={setEditing}
            expanded={expanded}
            setExpanded={setExpanded}
            onProducts={() => setShowProducts(true)}
            productCount={productCount}
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
            store={store}
            setStore={setStore}
            isPending={isPending}
            error={error}
            confirmDelete={confirmDelete}
            onSave={handleSave}
            onCancel={handleCancel}
            onDelete={handleDelete}
            onVerify={handleVerify}
            canVerify={canVerify}
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
            <td className="py-2 pr-2">
              <input
                value={store}
                onChange={(e) => setStore(e.target.value)}
                placeholder="Store"
                className={`${inputCls} w-full`}
              />
            </td>
            <td className="py-2 pr-2">
              <StatusBadge status={tx.status} />
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
              <td colSpan={6} className="pb-2 text-xs text-red-600">
                {error}
              </td>
            </tr>
          )}
        </>
      ) : (
        <tr
          onClick={() => setShowProducts(true)}
          title="View products"
          className="hidden md:table-row border-b border-zinc-100 cursor-pointer hover:bg-zinc-50"
        >
          <td className="py-2 pr-2 text-sm text-zinc-500">{tx.date}</td>
          <td className="py-2 pr-2 text-sm">{tx.category_name}</td>
          <td className="py-2 pr-2 text-sm text-zinc-500 truncate">
            {tx.store ?? <span className="text-zinc-300">—</span>}
          </td>
          <td className="py-2 pr-2">
            <StatusBadge status={tx.status} />
          </td>
          <td
            className={`py-2 pr-2 text-sm font-mono ${amountClass}`}
          >
            {amountText}
          </td>
          <td className="py-2">
            <div className="flex gap-2 justify-end">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleVerify();
                }}
                disabled={!canVerify || isPending}
                title={canVerify ? "Verify" : "Not ready to verify"}
                className="text-zinc-400 enabled:hover:text-emerald-600 disabled:opacity-40"
              >
                <VerifyIcon />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditing(true);
                }}
                title="Edit"
                className="text-zinc-400 hover:text-zinc-700"
              >
                <PencilIcon />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete();
                }}
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

      {showProducts && (
        <ProductsModal tx={tx} onClose={() => setShowProducts(false)} />
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
  onProducts,
  productCount,
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
  store,
  setStore,
  isPending,
  error,
  confirmDelete,
  onSave,
  onCancel,
  onDelete,
  onVerify,
  canVerify,
  amountClass,
  amountText,
}: {
  tx: Transaction;
  categories: Category[];
  editing: boolean;
  setEditing: (v: boolean) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  onProducts: () => void;
  productCount: number;
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
  store: string;
  setStore: (v: string) => void;
  isPending: boolean;
  error: string | null;
  confirmDelete: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onVerify: () => void;
  canVerify: boolean;
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
          value={store}
          onChange={(e) => setStore(e.target.value)}
          placeholder="Store (optional)"
          className={`w-full ${sheetInputCls}`}
        />
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
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-400">{formatMobileDate(tx.date)}</span>
            <StatusBadge status={tx.status} />
          </div>
        </div>
        <div className={`text-sm font-mono shrink-0 ${amountClass}`}>{amountText}</div>
        <ChevronIcon open={expanded} />
      </button>
      {expanded && (
        <div className="pb-3 space-y-3">
          <div className="text-sm text-zinc-500">
            <span className="text-zinc-400">Store: </span>
            {tx.store ?? "—"}
          </div>
          <div className="text-sm text-zinc-500">
            <span className="text-zinc-400">Note: </span>
            {tx.note ?? "—"}
          </div>
          <button
            onClick={onProducts}
            className="w-full min-h-11 rounded border border-zinc-300 text-sm text-zinc-700 flex items-center justify-center gap-2"
          >
            <BoxIcon />
            Products ({productCount})
          </button>
          {canVerify && (
            <button
              onClick={onVerify}
              disabled={isPending}
              className="w-full min-h-11 rounded border border-emerald-500 text-sm text-emerald-700 bg-emerald-50 flex items-center justify-center gap-2 disabled:opacity-40"
            >
              <VerifyIcon />
              Verify
            </button>
          )}
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

function BoxIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
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

function VerifyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
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
