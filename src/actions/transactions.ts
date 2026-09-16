"use server";

import { requireUser } from "@/lib/dal";
import {
  createTransactionFor,
  deleteTransactionFor,
  updateTransactionFor,
  verifyTransactionFor,
} from "@/lib/mutations/transactions";
import type { Product } from "@/actions/products";

export type TransactionStatus =
  | "processing"
  | "unverified"
  | "ready_to_verify"
  | "verified";

export type Transaction = {
  id: number;
  /** Manually entered amount — the authoritative figure. Null until the user
   *  types one (or verifies a scanned transaction, which copies the scanned
   *  total in). */
  amount: number | null;
  type: "income" | "spend";
  category_id: number | null;
  date: string;
  note: string | null;
  store: string | null;
  status: TransactionStatus;
  category_name?: string | null;
  products?: Product[];
  /** Id of the stored receipt image (LEFT JOIN in getTransactions), served at
   *  /api/receipts/[id]. Null when no receipt was ever scanned. */
  receipt_id?: number | null;
  /** The receipt grand total as read by the scan (receipts.total). Displayed as
   *  the fallback amount when no manual amount exists; a mismatch with a manual
   *  amount blocks verification. */
  scanned_total?: number | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export type TransactionFormState = {
  error?: string;
  successCount: number;
  /** Id of the transaction created by the most recent successful submit. The
   *  create UI uses it to fire a follow-up receipt scan against the new row. */
  lastTxId?: number;
};

// Thin wrappers: resolve the signed-in user, then delegate to the shared write
// logic in src/lib/mutations/transactions.ts (also used by the agent's
// proposal-apply path).

export async function createTransaction(
  prevState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { id: userId } = await requireUser();
  const result = await createTransactionFor(userId, formData);
  if (!result.ok) return { error: result.error, successCount: prevState.successCount };
  return { successCount: prevState.successCount + 1, lastTxId: result.id };
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return updateTransactionFor(userId, formData);
}

/** Promote a transaction from 'ready_to_verify' to 'verified' — see verifyTransactionFor. */
export async function verifyTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return verifyTransactionFor(userId, formData);
}

export async function deleteTransaction(formData: FormData) {
  const { id: userId } = await requireUser();
  await deleteTransactionFor(userId, formData);
}
