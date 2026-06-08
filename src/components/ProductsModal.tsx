"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { addProduct, updateProduct, deleteProduct } from "@/actions/products";
import { startReceiptScan, scanReceiptForTransaction } from "@/actions/receipt";
import { updateTransaction } from "@/actions/transactions";
import type { Product } from "@/actions/products";
import type { Transaction, TransactionStatus } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import ReceiptUpload, { type StagedImage } from "@/components/ReceiptUpload";

type FormFields = {
  name: string;
  brand: string;
  cost: string;
  product_type: string;
  tags: string;
  description: string;
  price: string;
  amount: string;
  unit: string;
};

const EMPTY_FORM: FormFields = {
  name: "",
  brand: "",
  cost: "",
  product_type: "",
  tags: "",
  description: "",
  price: "",
  amount: "",
  unit: "",
};

function toForm(p: Product): FormFields {
  return {
    name: p.name,
    brand: p.brand ?? "",
    cost: p.cost != null ? String(p.cost) : "",
    product_type: p.product_type ?? "",
    tags: p.tags.join(", "),
    description: p.description ?? "",
    price: p.price != null ? String(p.price) : "",
    amount: p.amount != null ? String(p.amount) : "",
    unit: p.unit ?? "",
  };
}

function appendFields(fd: FormData, f: FormFields) {
  fd.append("name", f.name);
  fd.append("brand", f.brand);
  fd.append("cost", f.cost);
  fd.append("product_type", f.product_type);
  fd.append("tags", f.tags);
  fd.append("description", f.description);
  fd.append("price", f.price);
  fd.append("amount", f.amount);
  fd.append("unit", f.unit);
}

const inputCls =
  "border border-zinc-300 rounded px-3 py-2 text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-zinc-400";

export default function ProductsModal({
  tx,
  categories,
  onClose,
}: {
  tx: Transaction;
  categories: Category[];
  onClose: () => void;
}) {
  const [showProducts, setShowProducts] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Only ever rendered client-side (gated behind a button click), so document
  // is always available — no SSR mount guard needed.
  const products = tx.products ?? [];
  const productCount = products.length;
  const productTotal = products.reduce((s, p) => s + (p.cost ?? 0), 0);
  // Loose ±1 tolerance — must mirror COST_TOLERANCE in src/actions/products.ts,
  // which drives the ready_to_verify status from the same comparison.
  const mismatch = Math.abs(productTotal - tx.amount) >= 1;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Transaction ${tx.category_name ?? ""}`.trim()}
        className="relative z-10 w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] flex flex-col safe-pb"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold truncate">
              {tx.category_name ?? "Transaction"}
            </h2>
            <p className="text-xs text-zinc-500 truncate">
              {tx.date} · {tx.amount.toFixed(2)}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            className="text-zinc-400 hover:text-zinc-700 shrink-0 inline-flex min-w-10 min-h-10 items-center justify-center -mr-2"
          >
            <XIcon />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          <TransactionEditor tx={tx} categories={categories} />

          <button
            type="button"
            onClick={() => setShowProducts((v) => !v)}
            aria-expanded={showProducts}
            className="w-full rounded border border-zinc-300 text-sm text-zinc-700 py-2 flex items-center justify-center gap-2"
          >
            <BoxIcon />
            {showProducts
              ? "Hide products"
              : `Show products${productCount ? ` (${productCount})` : ""}`}
          </button>

          {showProducts && (
            <div className="space-y-4">
              <div className="space-y-2">
                {products.length === 0 ? (
                  <p className="text-sm text-zinc-400">No products yet.</p>
                ) : (
                  products.map((p) => <ProductItem key={p.id} product={p} />)
                )}
              </div>

              <p
                className={`text-xs ${mismatch ? "text-red-600" : "text-emerald-600"}`}
              >
                Total: {productTotal.toFixed(2)}
                {mismatch && ` (${tx.amount.toFixed(2)})`}
              </p>

              <ReceiptScanner txId={tx.id} status={tx.status} />

              <AddProductForm txId={tx.id} />
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Transaction-level edit, moved here from the row. View mode shows the fields;
 *  pressing Edit swaps in a form wired to `updateTransaction`. */
function TransactionEditor({
  tx,
  categories,
}: {
  tx: Transaction;
  categories: Category[];
}) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(String(tx.amount));
  const [type, setType] = useState<Transaction["type"]>(tx.type);
  const [categoryId, setCategoryId] = useState(String(tx.category_id));
  const [date, setDate] = useState(tx.date);
  const [note, setNote] = useState(tx.note ?? "");
  const [store, setStore] = useState(tx.store ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function syncFromTx() {
    setAmount(String(tx.amount));
    setType(tx.type);
    setCategoryId(String(tx.category_id));
    setDate(tx.date);
    setNote(tx.note ?? "");
    setStore(tx.store ?? "");
  }

  function save() {
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

  function cancel() {
    syncFromTx();
    setError(null);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-zinc-500">Details</p>
          <button
            onClick={() => {
              // Re-sync from the current prop so a re-edit never shows a stale
              // value from a previous save.
              syncFromTx();
              setEditing(true);
            }}
            title="Edit"
            className="text-zinc-400 hover:text-zinc-700 inline-flex min-w-9 min-h-9 items-center justify-center -mr-2"
          >
            <PencilIcon />
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <Detail label="Amount" value={tx.amount.toFixed(2)} />
          {/* Spend is the default — only surface the type when it's income. */}
          {tx.type === "income" && <Detail label="Type" value="Income" />}
          {tx.category_name && (
            <Detail label="Category" value={tx.category_name} />
          )}
          <Detail label="Date" value={tx.date} />
          {tx.store && <Detail label="Store" value={tx.store} />}
          {tx.note && (
            <Detail label="Note" value={tx.note} className="col-span-2" />
          )}
        </dl>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount"
          aria-label="Amount"
          className={inputCls}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as Transaction["type"])}
          aria-label="Type"
          className={inputCls}
        >
          <option value="spend">Spend</option>
          <option value="income">Income</option>
        </select>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Category"
          className={inputCls}
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
          aria-label="Date"
          className={inputCls}
        />
      </div>
      <input
        value={store}
        onChange={(e) => setStore(e.target.value)}
        placeholder="Store (optional)"
        aria-label="Store"
        className={`w-full ${inputCls}`}
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)"
        aria-label="Note"
        className={`w-full ${inputCls}`}
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={cancel}
          className="rounded border border-zinc-300 text-sm text-zinc-700 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={isPending}
          className="rounded bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Detail({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-[11px] text-zinc-400">{label}</dt>
      <dd className="text-zinc-700 truncate">{value}</dd>
    </div>
  );
}

function ProductItem({ product }: { product: Product }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<FormFields>(() => toForm(product));
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  function save() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(product.id));
      appendFields(fd, form);
      const res = await updateProduct(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setEditing(false);
    });
  }

  function cancel() {
    setForm(toForm(product));
    setError(null);
    setEditing(false);
  }

  function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      confirmTimer.current = setTimeout(() => setConfirmDelete(false), 3000);
      return;
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current);
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(product.id));
      await deleteProduct(fd);
    });
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
        <ProductFieldsEditor form={form} setForm={setForm} />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            onClick={cancel}
            className="rounded border border-zinc-300 text-sm text-zinc-700 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={isPending}
            className="rounded bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  // Right-hand line-item maths: `price × quantity unit = cost`, degrading
  // gracefully when pieces are missing.
  const qty =
    product.amount != null
      ? `${product.amount}${product.unit ? ` ${product.unit}` : ""}`
      : product.unit ?? "";
  let breakdown = "";
  if (product.price != null && qty) breakdown = `${product.price.toFixed(2)} × ${qty}`;
  else if (product.price != null) breakdown = `@ ${product.price.toFixed(2)}`;
  else if (qty) breakdown = qty;

  return (
    <div className="rounded-lg border border-zinc-200 p-3 flex justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">
          {product.name}
          {product.brand && (
            <span className="text-zinc-400 font-normal"> · {product.brand}</span>
          )}
        </div>
        {product.product_type && (
          <div className="text-xs text-zinc-500">{product.product_type}</div>
        )}
        {product.description && (
          <p className="mt-1 text-xs text-zinc-400">{product.description}</p>
        )}
      </div>
      <div className="shrink-0 flex flex-col items-end justify-between gap-2 text-right">
        <div className="text-sm">
          {breakdown && (
            <span className="text-zinc-400">{breakdown} = </span>
          )}
          {product.cost != null ? (
            <span className="font-medium text-zinc-700">
              {product.cost.toFixed(2)}
            </span>
          ) : (
            <span className="font-semibold text-red-500">—</span>
          )}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => {
              // Re-sync from the current prop so a re-edit never shows a stale
              // (e.g. server-canonicalized) value from a previous save.
              setForm(toForm(product));
              setEditing(true);
            }}
            title="Edit"
            className="text-zinc-400 hover:text-zinc-700 inline-flex min-w-9 min-h-9 items-center justify-center"
          >
            <PencilIcon />
          </button>
          <button
            onClick={remove}
            disabled={isPending}
            title={confirmDelete ? "Click again to confirm" : "Delete"}
            className={`inline-flex min-w-9 min-h-9 items-center justify-center disabled:opacity-40 ${
              confirmDelete
                ? "text-red-500 hover:text-red-700"
                : "text-zinc-400 hover:text-red-500"
            }`}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function AddProductForm({ txId }: { txId: number }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormFields>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add() {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("transaction_id", String(txId));
      appendFields(fd, form);
      const res = await addProduct(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      setForm(EMPTY_FORM);
      setOpen(false);
    });
  }

  function cancel() {
    setForm(EMPTY_FORM);
    setError(null);
    setOpen(false);
  }

  // The form is collapsed until the user presses "Add product"; only then does
  // the field editor appear.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded border border-zinc-300 text-sm text-zinc-700 py-2"
      >
        Add product
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
      <p className="text-xs font-medium text-zinc-500">Add a product</p>
      <ProductFieldsEditor form={form} setForm={setForm} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button
          onClick={cancel}
          className="rounded border border-zinc-300 text-sm text-zinc-700 px-3 py-1.5"
        >
          Cancel
        </button>
        <button
          onClick={add}
          disabled={isPending}
          className="rounded bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ProductFieldsEditor({
  form,
  setForm,
}: {
  form: FormFields;
  setForm: (f: FormFields) => void;
}) {
  const set = (k: keyof FormFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm({ ...form, [k]: e.target.value });

  return (
    <div className="space-y-2">
      <input
        value={form.name}
        onChange={set("name")}
        placeholder="Name (required)"
        aria-label="Product name"
        className={`w-full ${inputCls}`}
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          value={form.brand}
          onChange={set("brand")}
          placeholder="Brand"
          aria-label="Brand"
          className={inputCls}
        />
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={form.cost}
          onChange={set("cost")}
          placeholder="Cost"
          aria-label="Cost"
          className={inputCls}
        />
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={form.price}
          onChange={set("price")}
          placeholder="Price"
          aria-label="Price"
          className={inputCls}
        />
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={form.amount}
          onChange={set("amount")}
          placeholder="Quantity"
          aria-label="Quantity"
          className={inputCls}
        />
        <input
          value={form.unit}
          onChange={set("unit")}
          placeholder="Unit"
          aria-label="Unit"
          className={inputCls}
        />
        <input
          value={form.product_type}
          onChange={set("product_type")}
          placeholder="Type"
          aria-label="Product type"
          className={inputCls}
        />
        <input
          value={form.tags}
          onChange={set("tags")}
          placeholder="Tags (comma-separated)"
          aria-label="Tags"
          className={`col-span-2 ${inputCls}`}
        />
      </div>
      <textarea
        value={form.description}
        onChange={set("description")}
        placeholder="Description"
        aria-label="Description"
        rows={2}
        className={`w-full ${inputCls}`}
      />
    </div>
  );
}

/** Receipt scanner — mirrors the create flow's two-phase split. Pressing Scan
 *  awaits `startReceiptScan` (clears the existing products + marks the row
 *  `processing`); its `revalidatePath` then re-flows this open modal's `tx`
 *  props. Only once the row actually reads `processing` does an effect fire the
 *  background `scanReceiptForTransaction` (fire-and-forget) as a SEPARATE
 *  dispatch. Firing it in the same transition as `startReceiptScan` swallowed
 *  that action's router refresh, so the cleared/processing state never showed
 *  and the row's status never updated until the whole scan finished. While the
 *  transaction is `processing` a new scan is blocked. */
function ReceiptScanner({
  txId,
  status,
}: {
  txId: number;
  status: TransactionStatus;
}) {
  const [image, setImage] = useState<StagedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Holds the staged image between `startReceiptScan` succeeding and the row
  // re-rendering as `processing`, at which point the effect fires the scan.
  const pendingImage = useRef<StagedImage | null>(null);
  const fired = useRef(false);

  const processing = status === "processing";
  const busy = isPending || processing;

  useEffect(() => {
    if (processing) {
      // The row is now `processing` (startReceiptScan's revalidation landed).
      // Fire the background vision scan once, as its own dispatch.
      if (pendingImage.current && !fired.current) {
        fired.current = true;
        const img = pendingImage.current;
        pendingImage.current = null;
        const scanFd = new FormData();
        scanFd.append("transaction_id", String(txId));
        scanFd.append("image", img.dataUrl);
        void scanReceiptForTransaction(scanFd);
      }
    } else {
      // Scan resolved (or never started) — re-arm for the next scan.
      fired.current = false;
    }
  }, [processing, txId]);

  function scan() {
    if (!image || busy) return;
    startTransition(async () => {
      const startFd = new FormData();
      startFd.append("transaction_id", String(txId));
      const started = await startReceiptScan(startFd);
      if (!started.ok) {
        setError(started.error);
        return;
      }
      // Defer the vision scan to the effect, which fires it once the row reflects
      // `processing` — keeping it out of this transition so startReceiptScan's
      // revalidation (clear products + mark processing) actually reaches the UI.
      pendingImage.current = image;
      setError(null);
      setImage(null);
    });
  }

  return (
    <div className="rounded-lg border border-dashed border-zinc-300 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <ReceiptUpload
          value={image}
          onChange={(img) => {
            setImage(img);
            setError(null);
          }}
          disabled={busy}
        />
        <button
          type="button"
          onClick={scan}
          disabled={!image || busy}
          className="shrink-0 rounded bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {processing ? "Scanning…" : isPending ? "Starting…" : "Scan"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-zinc-400">
        {processing
          ? "Scanning the receipt — line items will appear here shortly."
          : "Upload a receipt photo to auto-add its line items as products."}
      </p>
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

function XIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
