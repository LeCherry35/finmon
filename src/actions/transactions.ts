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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Parse an optional amount field: blank → null, otherwise it must be a positive
 *  number. Mirrors `parsePositive` in products.ts but for a single field. */
function parseOptionalAmount(
  formData: FormData,
): number | null | { error: string } {
  const raw = ((formData.get("amount") as string | null) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: "Amount must be positive" };
  return n;
}

export async function createTransaction(
  prevState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { id: userId } = await requireUser();

  const amount = parseOptionalAmount(formData);
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

  if (amount !== null && typeof amount === "object") return fail(amount.error);
  if (!["income", "spend"].includes(type)) return fail("Invalid type");
  // Amount and category are optional individually — a staged receipt can fill
  // them in — but a transaction can't start with nothing at all.
  if (amount === null && !categoryName && !hasReceipt)
    return fail("Add an amount, a category, or a receipt photo");
  if (!date) return fail("Date is required");
  if (!DATE_RE.test(date)) return fail("Date must be YYYY-MM-DD");

  let category_id: number | null = null;
  if (categoryName) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO categories (name, user_id) VALUES ($1, $2)
       ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [categoryName, userId]
    );
    category_id = rows[0].id;
  }

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
  if (categoryName) revalidatePath("/categories");
  return { successCount: prevState.successCount + 1, lastTxId: txRows[0].id };
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  const amount = parseOptionalAmount(formData);
  const type = formData.get("type") as string;
  const rawCategoryId = ((formData.get("category_id") as string | null) ?? "").trim();
  const category_id = rawCategoryId === "" ? null : Number(rawCategoryId);
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;
  const store = ((formData.get("store") as string | null) ?? "").trim() || null;

  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };
  if (amount !== null && typeof amount === "object") return { ok: false, error: amount.error };
  if (!["income", "spend"].includes(type)) return { ok: false, error: "Invalid type" };
  if (category_id !== null && (!Number.isFinite(category_id) || category_id <= 0))
    return { ok: false, error: "Invalid category" };
  if (!date) return { ok: false, error: "Date is required" };
  if (!DATE_RE.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD" };

  if (category_id !== null && !(await userOwnsCategory(userId, category_id)))
    return { ok: false, error: "Invalid category" };

  // Same rule as creation: a transaction can't be edited down to nothing — with
  // both amount and category blank, a stored receipt must be there to fill in.
  if (amount === null && category_id === null) {
    const { rowCount } = await pool.query(
      "SELECT 1 FROM receipts WHERE transaction_id = $1 AND user_id = $2",
      [id, userId]
    );
    if (rowCount === 0)
      return { ok: false, error: "Add an amount, a category, or a receipt photo" };
  }

  // Capture the previous amount in the same round-trip so we can tell whether
  // the total actually moved. (NUMERIC comes back from pg as a string.)
  const { rows: updated } = await pool.query<{ prev_amount: string | null }>(
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
  // moved (including to/from blank), so editing an unrelated field
  // (note/date/category) never downgrades a 'verified' row.
  const prevAmount =
    updated[0] && updated[0].prev_amount !== null
      ? Number(updated[0].prev_amount)
      : null;
  if (updated[0] && prevAmount !== amount) {
    await recomputeTransactionStatus(userId, id);
  }

  revalidatePath("/transactions");
  return { ok: true };
}

/** Promote a transaction from 'ready_to_verify' to 'verified'. Guarded so only a
 *  transaction whose product costs already sum to its effective amount (status
 *  set to 'ready_to_verify' by recomputeTransactionStatus) can be verified — the
 *  WHERE clause enforces the source state, so a no-op update means it wasn't
 *  eligible. Verifying with no manual amount adopts the scanned receipt total
 *  (a correlated subquery, not a join, so receipt-less rows still verify), so
 *  every verified transaction ends up with a filled amount. */
export async function verifyTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };

  const { rowCount } = await pool.query(
    `UPDATE transactions t
     SET status = 'verified',
         amount = COALESCE(t.amount, (SELECT total FROM receipts r WHERE r.transaction_id = t.id))
     WHERE t.id = $1 AND t.user_id = $2 AND t.status = 'ready_to_verify'`,
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
