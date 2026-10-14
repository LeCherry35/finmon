import "server-only";
import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsCategory } from "@/db/queries";
import { recomputeTransactionStatus } from "@/lib/mutations/products";
import { BASE_CURRENCY, isCurrency, type Currency } from "@/lib/currencies";
import { CurrencyError, toBase } from "@/lib/currency";
import type { ActionResult } from "@/actions/transactions";

// Transaction write logic, keyed by an explicit `userId`. The "use server"
// actions in src/actions/transactions.ts resolve the user via requireUser() and
// delegate here; the agent's proposal-apply path (src/actions/agent.ts) calls
// the same functions. Never export these from a "use server" module — a client
// could then pass any userId.

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

type Money = { amount: number | null; currency: Currency; original_amount: number | null; exchange_rate: number | null };

/** The entered `amount` is in the form's `currency` (blank → UAH). A USD/EUR
 *  amount is converted to UAH at the NBU rate of `date`; the stored `amount` is
 *  always UAH, with the entered figure and rate kept beside it. */
async function toMoney(formData: FormData, amount: number | null, date: string): Promise<Money | { error: string }> {
  const raw = ((formData.get("currency") as string | null) ?? "").trim() || BASE_CURRENCY;
  if (!isCurrency(raw)) return { error: "Invalid currency" };
  if (amount === null || raw === BASE_CURRENCY)
    return { amount, currency: BASE_CURRENCY, original_amount: null, exchange_rate: null };
  try {
    const uah = await toBase(amount, raw, date);
    return { amount: uah.amount, currency: raw, original_amount: amount, exchange_rate: uah.rate };
  } catch (err) {
    if (err instanceof CurrencyError) return { error: err.message };
    throw err;
  }
}

export async function createTransactionFor(
  userId: string,
  formData: FormData,
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
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

  const fail = (error: string) => ({ ok: false as const, error });

  if (amount !== null && typeof amount === "object") return fail(amount.error);
  if (!["income", "spend"].includes(type)) return fail("Invalid type");
  // Amount and category are optional individually — a staged receipt can fill
  // them in — but a transaction can't start with nothing at all.
  if (amount === null && !categoryName && !hasReceipt)
    return fail("Add an amount, a category, or a receipt photo");
  if (!date) return fail("Date is required");
  if (!DATE_RE.test(date)) return fail("Date must be YYYY-MM-DD");

  const money = await toMoney(formData, amount, date);
  if ("error" in money) return fail(money.error);

  let category_id: number | null = null;
  if (categoryName) {
    // Reuse an existing category that differs only in case ("food" → "Food");
    // an exact spelling wins if both exist.
    const { rows: existing } = await pool.query<{ id: number }>(
      `SELECT id FROM categories WHERE user_id = $1 AND lower(name) = lower($2)
       ORDER BY (name = $2) DESC, id LIMIT 1`,
      [userId, categoryName]
    );
    if (existing.length > 0) {
      category_id = existing[0].id;
    } else {
      const { rows } = await pool.query<{ id: number }>(
        `INSERT INTO categories (name, user_id) VALUES ($1, $2)
         ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [categoryName, userId]
      );
      category_id = rows[0].id;
    }
  }

  // A transaction starts with no products: they're an optional breakdown the
  // user can add later (transactions.amount stays the source of truth). Status
  // defaults to 'unverified' until product costs are added that sum to amount —
  // unless a receipt was staged, in which case it starts 'processing'.
  const status = hasReceipt ? "processing" : "unverified";
  const { rows: txRows } = await pool.query<{ id: number }>(
    `INSERT INTO transactions
       (amount, type, category_id, date, note, store, status, user_id, currency, original_amount, exchange_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [money.amount, type, category_id, date, note, store, status, userId,
     money.currency, money.original_amount, money.exchange_rate]
  );

  revalidatePath("/transactions");
  if (categoryName) revalidatePath("/categories");
  return { ok: true, id: txRows[0].id };
}

export async function updateTransactionFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
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

  // Always re-converted: a rate is fixed per day (and cached), so an unchanged
  // amount/currency/date gives the same UAH figure.
  const money = await toMoney(formData, amount, date);
  if ("error" in money) return { ok: false, error: money.error };

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
     SET amount = $1, type = $2, category_id = $3, date = $4, note = $5, store = $6,
         currency = $9, original_amount = $10, exchange_rate = $11
     FROM prev
     WHERE t.id = $7 AND t.user_id = $8
     RETURNING prev.amount AS prev_amount`,
    [money.amount, type, category_id, date, note, store, id, userId,
     money.currency, money.original_amount, money.exchange_rate]
  );

  // Changing the amount can make the product-cost sum start (or stop) matching
  // the new total, so re-derive status — but only when the amount actually
  // moved (including to/from blank), so editing an unrelated field
  // (note/date/category) never downgrades a 'verified' row.
  const prevAmount =
    updated[0] && updated[0].prev_amount !== null
      ? Number(updated[0].prev_amount)
      : null;
  if (updated[0] && prevAmount !== money.amount) {
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
 *  with its currency, original and rate (a LEFT JOIN, so receipt-less rows still
 *  verify), so every verified transaction ends up with a filled amount. */
export async function verifyTransactionFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };

  const { rowCount } = await pool.query(
    `UPDATE transactions t
     SET status = 'verified',
         amount = COALESCE(t.amount, r.total),
         currency = CASE WHEN t.amount IS NULL AND r.total IS NOT NULL THEN r.currency ELSE t.currency END,
         original_amount = CASE WHEN t.amount IS NULL AND r.total IS NOT NULL THEN r.original_total ELSE t.original_amount END,
         exchange_rate = CASE WHEN t.amount IS NULL AND r.total IS NOT NULL THEN r.exchange_rate ELSE t.exchange_rate END
     FROM (SELECT 1) one
     LEFT JOIN receipts r ON r.transaction_id = $1
     WHERE t.id = $1 AND t.user_id = $2 AND t.status = 'ready_to_verify'`,
    [id, userId]
  );
  if (rowCount === 0) return { ok: false, error: "Transaction is not ready to verify" };

  revalidatePath("/transactions");
  return { ok: true };
}

/** Delete a transaction (its products and receipt go with it via cascade).
 *  Reports `ok: false` when nothing matched — the UI action ignores that, the
 *  agent surfaces it. */
export async function deleteTransactionFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };
  const result = await pool.query(
    "DELETE FROM transactions WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  revalidatePath("/transactions");
  if (result?.rowCount === 0) return { ok: false, error: "Transaction not found" };
  return { ok: true };
}

/** Delete several transactions at once (the assistant's delete_transactions);
 *  returns the ids that existed and were deleted. */
export async function deleteTransactionsFor(userId: string, ids: number[]): Promise<number[]> {
  const { rows } = await pool.query<{ id: number }>(
    "DELETE FROM transactions WHERE user_id = $1 AND id = ANY($2::int[]) RETURNING id",
    [userId, ids],
  );
  revalidatePath("/transactions");
  return rows.map((r) => r.id);
}
