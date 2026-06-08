"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { addProduct, updateProduct, deleteProduct } from "@/actions/products";
import { scanReceiptForTransaction } from "@/actions/receipt";
import type { Product } from "@/actions/products";
import type { Transaction } from "@/actions/transactions";
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
  onClose,
}: {
  tx: Transaction;
  onClose: () => void;
}) {
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
  const productTotal = products.reduce((s, p) => s + (p.cost ?? 0), 0);
  const mismatch = Math.abs(productTotal - tx.amount) > 0.005;

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
        aria-label={`Products for ${tx.category_name ?? "transaction"}`}
        className="relative z-10 w-full md:max-w-lg bg-white rounded-t-2xl md:rounded-2xl shadow-xl max-h-[90vh] flex flex-col safe-pb"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-zinc-100">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Products</h2>
            <p className="text-xs text-zinc-500 truncate">
              {tx.category_name} · {tx.date} · {tx.amount.toFixed(2)}
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
          <div className="space-y-2">
            {products.length === 0 ? (
              <p className="text-sm text-zinc-400">No products yet.</p>
            ) : (
              products.map((p) => <ProductItem key={p.id} product={p} />)
            )}
          </div>

          <p
            className={`text-xs ${mismatch ? "text-amber-600" : "text-zinc-400"}`}
          >
            Products total: {productTotal.toFixed(2)} / transaction {tx.amount.toFixed(2)}
            {mismatch && " — these don't match (that's allowed)"}
          </p>

          <ReceiptScanner txId={tx.id} />

          <AddProductForm txId={tx.id} />
        </div>
      </div>
    </div>,
    document.body,
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

  return (
    <div className="rounded-lg border border-zinc-200 p-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium truncate">
          {product.name}
          {product.brand && (
            <span className="text-zinc-400 font-normal"> · {product.brand}</span>
          )}
        </div>
        <div className="text-xs text-zinc-500 space-x-2">
          {product.cost != null && <span>{product.cost.toFixed(2)}</span>}
          {(product.amount != null || product.unit) && (
            <span>
              · {product.amount != null ? product.amount : ""}
              {product.amount != null && product.unit ? " " : ""}
              {product.unit ?? ""}
              {product.price != null && ` @ ${product.price.toFixed(2)}`}
            </span>
          )}
          {product.amount == null && !product.unit && product.price != null && (
            <span>· @ {product.price.toFixed(2)}</span>
          )}
          {product.product_type && <span>· {product.product_type}</span>}
        </div>
        {product.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {product.tags.map((t) => (
              <span
                key={t}
                className="text-[11px] bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.5"
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {product.description && (
          <p className="mt-1 text-xs text-zinc-400">{product.description}</p>
        )}
      </div>
      <div className="flex gap-1 shrink-0">
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
  );
}

function AddProductForm({ txId }: { txId: number }) {
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
    });
  }

  return (
    <div className="rounded-lg border border-zinc-200 p-3 space-y-2">
      <p className="text-xs font-medium text-zinc-500">Add a product</p>
      <ProductFieldsEditor form={form} setForm={setForm} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        onClick={add}
        disabled={isPending}
        className="w-full rounded bg-zinc-900 text-white text-sm py-2 disabled:opacity-50"
      >
        Add product
      </button>
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

/** Receipt scanner — uploads a receipt photo to the OpenAI vision pipeline and
 *  attaches the parsed line items as products. The list above refreshes live
 *  because `scanReceiptForTransaction` calls `revalidatePath("/transactions")`,
 *  which re-flows this open modal's `tx` props (same mechanism as add/edit). */
function ReceiptScanner({ txId }: { txId: number }) {
  const [image, setImage] = useState<StagedImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function scan() {
    if (!image) return;
    startTransition(async () => {
      const fd = new FormData();
      fd.append("transaction_id", String(txId));
      fd.append("image", image.dataUrl);
      const res = await scanReceiptForTransaction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
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
          disabled={isPending}
        />
        <button
          type="button"
          onClick={scan}
          disabled={!image || isPending}
          className="shrink-0 rounded bg-zinc-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {isPending ? "Scanning…" : "Scan"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <p className="text-[11px] text-zinc-400">
        Upload a receipt photo to auto-add its line items as products.
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
