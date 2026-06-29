"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTransaction, verifyTransaction } from "@/actions/transactions";
import type { Transaction, TransactionStatus } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import ProductsModal from "@/components/ProductsModal";

const STATUS_META: Record<TransactionStatus, { label: string; cls: string }> = {
  processing: { label: "Processing", cls: "bg-amber-100 text-amber-700" },
  unverified: { label: "Unverified", cls: "bg-zinc-100 text-zinc-600" },
  ready_to_verify: { label: "Ready to verify", cls: "bg-blue-100 text-blue-700" },
  verified: { label: "Verified", cls: "bg-emerald-100 text-emerald-700" },
};

/** Status pill. When the transaction is `ready_to_verify` the pill becomes the
 *  verify control — clicking it promotes the row to `verified` (the Verify
 *  button used to live in the row actions). `stopPropagation` keeps the click
 *  from also opening the modal/expanding the mobile card. */
function StatusBadge({
  tx,
  className,
}: {
  tx: Transaction;
  className?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const { label, cls } = STATUS_META[tx.status] ?? STATUS_META.unverified;
  const base = `inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`;

  if (tx.status !== "ready_to_verify") {
    return <span className={`${base} ${className ?? ""}`}>{label}</span>;
  }

  function verify(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const fd = new FormData();
      fd.append("id", String(tx.id));
      await verifyTransaction(fd);
    });
  }

  return (
    <button
      type="button"
      onClick={verify}
      disabled={isPending}
      title="Click to verify"
      className={`${base} ${className ?? ""} cursor-pointer hover:ring-1 hover:ring-blue-400 disabled:opacity-50`}
    >
      {label}
    </button>
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
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();

  useEffect(() => {
    return () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
    };
  }, []);

  // Self-heal while scanning: a receipt scan runs as a fire-and-forget action
  // whose `revalidatePath` may not reach this client (orphaned / swallowed
  // refresh), which would leave the row visually stuck on `processing` even
  // after the server finished and recomputed the status. Poll `router.refresh()`
  // while `processing`; the effect tears down the moment the status changes.
  useEffect(() => {
    if (tx.status !== "processing") return;
    const interval = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(interval);
  }, [tx.status, router]);

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
            expanded={expanded}
            setExpanded={setExpanded}
            onOpen={() => setModalOpen(true)}
            isPending={isPending}
            confirmDelete={confirmDelete}
            onDelete={handleDelete}
            amountClass={amountClass}
            amountText={amountText}
          />
        </td>
      </tr>

      {/* DESKTOP row */}
      <tr
        onClick={() => setModalOpen(true)}
        title="View details"
        className="hidden md:table-row border-b border-zinc-100 cursor-pointer hover:bg-zinc-50"
      >
        <td className="py-2 pr-2 text-sm text-zinc-500">{tx.date}</td>
        <td className="py-2 pr-2 text-sm">{tx.category_name}</td>
        <td className="py-2 pr-2 text-sm text-zinc-500 truncate">
          {tx.store ?? <span className="text-zinc-300">—</span>}
        </td>
        <td className="py-2 pr-2">
          <StatusBadge tx={tx} />
        </td>
        <td className={`py-2 pr-2 text-sm font-mono ${amountClass}`}>
          {amountText}
        </td>
        <td className="py-2">
          <div className="flex gap-2 justify-end">
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

      {modalOpen && (
        <ProductsModal
          tx={tx}
          categories={categories}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
}

function MobileCard({
  tx,
  expanded,
  setExpanded,
  onOpen,
  isPending,
  confirmDelete,
  onDelete,
  amountClass,
  amountText,
}: {
  tx: Transaction;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  onOpen: () => void;
  isPending: boolean;
  confirmDelete: boolean;
  onDelete: () => void;
  amountClass: string;
  amountText: string;
}) {
  return (
    <div className="border-b border-zinc-100">
      {/* A div (not a button) so the verify-capable StatusBadge can nest as its
          own button without invalid button-in-button markup. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
        className="w-full text-left flex items-center justify-between gap-3 py-3 min-h-12 cursor-pointer"
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">{tx.category_name}</div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[11px] text-zinc-400">{formatMobileDate(tx.date)}</span>
            <StatusBadge tx={tx} />
          </div>
        </div>
        <div className={`text-sm font-mono shrink-0 ${amountClass}`}>{amountText}</div>
        <ChevronIcon open={expanded} />
      </div>
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
            onClick={onOpen}
            className="w-full min-h-11 rounded border border-zinc-300 text-sm text-zinc-700 flex items-center justify-center gap-2"
          >
            <BoxIcon />
            Details
          </button>
          <button
            onClick={onDelete}
            disabled={isPending}
            className={`w-full min-h-11 rounded border text-sm flex items-center justify-center gap-2 disabled:opacity-40 ${
              confirmDelete
                ? "border-red-500 text-red-600 bg-red-50"
                : "border-zinc-300 text-zinc-700"
            }`}
          >
            <TrashIcon />
            {confirmDelete ? "Tap again" : "Delete"}
          </button>
        </div>
      )}
    </div>
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
