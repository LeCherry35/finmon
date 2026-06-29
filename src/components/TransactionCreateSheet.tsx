"use client";

import { useActionState, useEffect, useState } from "react";
import { createTransaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import ReceiptUpload from "@/components/ReceiptUpload";
import { useReceiptScanCreate } from "@/components/useReceiptScanCreate";

export default function TransactionCreateSheet({
  categories,
  today,
}: {
  categories: Category[];
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createTransaction, {
    successCount: 0,
  });
  const { receipt, setReceipt } = useReceiptScanCreate(state);
  const [lastSeenSuccess, setLastSeenSuccess] = useState(0);

  if (state.successCount !== lastSeenSuccess) {
    setLastSeenSuccess(state.successCount);
    if (state.successCount > 0) setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const inputCls =
    "w-full border border-zinc-300 rounded px-3 py-2 text-base focus:outline-none focus:ring-1 focus:ring-zinc-400";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Add transaction"
        className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] z-30 w-14 h-14 rounded-full bg-zinc-900 text-white shadow-lg flex items-center justify-center text-2xl leading-none md:hidden active:scale-95 transition-transform"
      >
        +
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="New transaction"
            className="fixed inset-x-0 bottom-0 z-50 md:hidden rounded-t-2xl bg-white border-t border-zinc-200 max-h-[90vh] overflow-y-auto safe-pb"
          >
            <div className="flex flex-col items-center pt-2">
              <span className="block h-1 w-10 rounded-full bg-zinc-300" />
            </div>
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <h2 className="text-base font-semibold">New transaction</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="w-10 h-10 -mr-2 flex items-center justify-center text-zinc-400 hover:text-zinc-700"
              >
                <XIcon />
              </button>
            </div>
            <form
              key={state.successCount}
              action={formAction}
              className="px-4 pb-4 space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <Field label="Amount">
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    inputMode="decimal"
                    placeholder="0.00"
                    className={inputCls}
                  />
                </Field>
                <Field label="Type">
                  <select name="type" required className={inputCls}>
                    <option value="spend">Spend</option>
                    <option value="income">Income</option>
                  </select>
                </Field>
              </div>
              <Field label="Category">
                <input
                  name="category_name"
                  list="category-options-sheet"
                  required
                  placeholder="Category"
                  className={inputCls}
                />
                <datalist id="category-options-sheet">
                  {categories.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </Field>
              <Field label="Date">
                <input
                  name="date"
                  type="date"
                  defaultValue={today}
                  required
                  className={inputCls}
                />
              </Field>
              <Field label="Store">
                <input
                  name="store"
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>
              <Field label="Note">
                <input
                  name="note"
                  placeholder="Optional"
                  className={inputCls}
                />
              </Field>
              <Field label="Receipt">
                <ReceiptUpload
                  value={receipt}
                  onChange={setReceipt}
                  disabled={pending}
                />
              </Field>
              <input type="hidden" name="has_receipt" value={receipt ? "1" : ""} />
              {state.error && (
                <p className="text-sm text-red-600">{state.error}</p>
              )}
              <button
                type="submit"
                disabled={pending}
                className="w-full bg-zinc-900 text-white text-base font-medium px-4 py-3 rounded-lg hover:bg-zinc-700 disabled:opacity-50"
              >
                {pending
                  ? "Adding…"
                  : receipt
                    ? "Scan & add transaction"
                    : "Add transaction"}
              </button>
            </form>
          </div>
        </>
      )}
    </>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-zinc-500 mb-1">{label}</span>
      {children}
    </label>
  );
}

function XIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
