"use client";

import { useActionState, useState } from "react";
import { createTransaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import ReceiptUpload from "@/components/ReceiptUpload";
import {
  emptyTransactionGuard,
  useReceiptScanCreate,
} from "@/components/useReceiptScanCreate";

export default function TransactionCreateForm({
  categories,
  today,
}: {
  categories: Category[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(createTransaction, {
    successCount: 0,
  });
  const { receipt, setReceipt } = useReceiptScanCreate(state);
  const [guardError, setGuardError] = useState<string | null>(null);

  const inputCls =
    "border border-zinc-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400";

  return (
    <form
      key={state.successCount}
      action={formAction}
      onSubmit={(e) => {
        const err = emptyTransactionGuard(e.currentTarget, receipt !== null);
        if (err) {
          e.preventDefault();
          setGuardError(err);
        } else {
          setGuardError(null);
        }
      }}
      className="hidden md:block space-y-2"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <input
          name="amount"
          type="number"
          step="0.01"
          min="0.01"
          placeholder="Amount"
          className={inputCls}
        />
        <select name="type" required className={inputCls}>
          <option value="spend">Spend</option>
          <option value="income">Income</option>
        </select>
        <input
          name="category_name"
          list="category-options"
          placeholder="Category"
          className={inputCls}
        />
        <datalist id="category-options">
          {categories.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <input
          name="date"
          type="date"
          defaultValue={today}
          required
          className={inputCls}
        />
      </div>
      <div className="flex gap-3">
        <input
          name="store"
          placeholder="Store (optional)"
          className={`flex-1 ${inputCls}`}
        />
        <input
          name="note"
          placeholder="Note (optional)"
          className={`flex-1 ${inputCls}`}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <ReceiptUpload value={receipt} onChange={setReceipt} disabled={pending} />
        <input type="hidden" name="has_receipt" value={receipt ? "1" : ""} />
        <button
          type="submit"
          disabled={pending}
          className="shrink-0 bg-zinc-800 text-white text-sm px-4 py-2 rounded hover:bg-zinc-700 disabled:opacity-50"
        >
          {receipt ? "Scan & add" : "Add"}
        </button>
      </div>
      {(guardError ?? state.error) && (
        <p className="text-sm text-red-600">{guardError ?? state.error}</p>
      )}
    </form>
  );
}
