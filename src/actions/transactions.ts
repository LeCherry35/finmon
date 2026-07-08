"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsCategory } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import { recomputeTransactionStatus, type Product } from "@/actions/products";

export type TransactionStatus =
  | "processing"
  | "unverified"
  | "ready_to_verify"
  | "verified";

export type Transaction = {
  id: number;
  amount: number;
  type: "income" | "spend";
  category_id: number;
  date: string;
  note: string | null;
  store: string | null;
  status: TransactionStatus;
  category_name?: string;
  products?: Product[];
  /** Id of the stored receipt image (LEFT JOIN in getTransactions), served at
   *  /api/receipts/[id]. Null when no receipt was ever scanned. */
  receipt_id?: number | null;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export type TransactionFormState = {
  error?: string;
  successCount: number;
  /** Id of the transaction created by the most recent successful submit. The
   *  create UI uses it to fire a follow-up receipt scan against the new row. */
  lastTxId?: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createTransaction(
  prevState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { id: userId } = await requireUser();

  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const categoryName = ((formData.get("category_name") as string | null) ?? "").trim();
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;
  const store = ((formData.get("store") as string | null) ?? "").trim() || null;
  // A receipt was staged in the create UI: start the row as 'processing' so it
  // reads as "scanning" until the follow-up scan attaches products and the
  // status is recomputed. Without a receipt it keeps the default 'unverified'.
  const hasReceipt = formData.get("has_receipt") === "1";

  const fail = (error: string): TransactionFormState => ({
    error,
    successCount: prevState.successCount,
  });

  if (!Number.isFinite(amount) || amount <= 0) return fail("Amount must be positive");
  if (!["income", "spend"].includes(type)) return fail("Invalid type");
  if (!categoryName) return fail("Category is required");
  if (!date) return fail("Date is required");
  if (!DATE_RE.test(date)) return fail("Date must be YYYY-MM-DD");

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO categories (name, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [categoryName, userId]
  );
  const category_id = rows[0].id;

  // A transaction starts with no products: they're an optional breakdown the
  // user can add later (transactions.amount stays the source of truth). Status
  // defaults to 'unverified' until product costs are added that sum to amount —
  // unless a receipt was staged, in which case it starts 'processing'.
  const status = hasReceipt ? "processing" : "unverified";
  const { rows: txRows } = await pool.query<{ id: number }>(
    "INSERT INTO transactions (amount, type, category_id, date, note, store, status, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    [amount, type, category_id, date, note, store, status, userId]
  );

  revalidatePath("/transactions");
  revalidatePath("/categories");
  return { successCount: prevState.successCount + 1, lastTxId: txRows[0].id };
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const category_id = Number(formData.get("category_id"));
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;
  const store = ((formData.get("store") as string | null) ?? "").trim() || null;

  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be positive" };
  if (!["income", "spend"].includes(type)) return { ok: false, error: "Invalid type" };
  if (!Number.isFinite(category_id) || category_id <= 0) return { ok: false, error: "Category is required" };
  if (!date) return { ok: false, error: "Date is required" };
  if (!DATE_RE.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD" };

  if (!(await userOwnsCategory(userId, category_id)))
    return { ok: false, error: "Invalid category" };

  // Capture the previous amount in the same round-trip so we can tell whether
  // the total actually moved. (NUMERIC comes back from pg as a string.)
  const { rows: updated } = await pool.query<{ prev_amount: string }>(
    `WITH prev AS (
       SELECT amount FROM transactions WHERE id = $7 AND user_id = $8
     )
     UPDATE transactions t
     SET amount = $1, type = $2, category_id = $3, date = $4, note = $5, store = $6
     FROM prev
     WHERE t.id = $7 AND t.user_id = $8
     RETURNING prev.amount AS prev_amount`,
    [amount, type, category_id, date, note, store, id, userId]
  );

  // Changing the amount can make the product-cost sum start (or stop) matching
  // the new total, so re-derive status — but only when the amount actually
  // moved, so editing an unrelated field (note/date/category) never downgrades
  // a 'verified' row.
  if (updated[0] && Number(updated[0].prev_amount) !== amount) {
    await recomputeTransactionStatus(userId, id);
  }

  revalidatePath("/transactions");
  return { ok: true };
}

/** Promote a transaction from 'ready_to_verify' to 'verified'. Guarded so only a
 *  transaction whose product costs already sum to its amount (status set to
 *  'ready_to_verify' by recomputeTransactionStatus) can be verified — the WHERE
 *  clause enforces the source state, so a no-op update means it wasn't eligible. */
export async function verifyTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };

  const { rowCount } = await pool.query(
    "UPDATE transactions SET status = 'verified' WHERE id = $1 AND user_id = $2 AND status = 'ready_to_verify'",
    [id, userId]
  );
  if (rowCount === 0) return { ok: false, error: "Transaction is not ready to verify" };

  revalidatePath("/transactions");
  return { ok: true };
}

export async function deleteTransaction(formData: FormData) {
  const { id: userId } = await requireUser();
  const id = Number(formData.get("id"));
  await pool.query("DELETE FROM transactions WHERE id = $1 AND user_id = $2", [id, userId]);
  revalidatePath("/transactions");
}
