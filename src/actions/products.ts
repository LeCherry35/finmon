"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsTransaction } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import type { ActionResult } from "@/actions/transactions";

export type Product = {
  id: number;
  transaction_id: number;
  name: string;
  brand: string | null;
  cost: number | null;
  product_type: string | null;
  tags: string[];
  description: string | null;
  price: number | null;
  amount: number | null;
  unit: string | null;
};

/** Parsed-and-validated product fields shared by add/update. Numeric fields are
 *  null when omitted; only `name` is required. `amount` is the quantity. Returns
 *  an error string on failure. Also produced by the receipt scanner
 *  (`src/lib/receipt-scan.ts`) and consumed by `insertProducts`. */
export type ProductFields = {
  name: string;
  brand: string | null;
  cost: number | null;
  product_type: string | null;
  tags: string[];
  description: string | null;
  price: number | null;
  amount: number | null;
  unit: string | null;
};

/** Product costs are treated as matching the transaction amount when they're
 *  within this tolerance — a deliberately loose ±1 (currency units), so small
 *  rounding / a missing minor line item still reads as "matches". Mirrors the
 *  mismatch threshold used in the products UI. */
const COST_TOLERANCE = 1;

/** Recompute a transaction's status from its product line items: when the sum
 *  of product costs matches the effective amount (manual `amount`, or the
 *  scanned `receipts.total` when no manual amount exists) it becomes
 *  'ready_to_verify', otherwise 'unverified'. A manual amount that disagrees
 *  with the scanned total (≥ COST_TOLERANCE apart) is a mismatch — the
 *  transaction can never become 'ready_to_verify' until one of them changes.
 *  Applied unconditionally (a 'verified' transaction can be downgraded). Call
 *  after any product add/update/delete. Exported so the receipt-scan action
 *  (`src/actions/receipt.ts`) reuses the same transition. */
export async function recomputeTransactionStatus(userId: string, transactionId: number) {
  const { rows } = await pool.query<{
    amount: number | null;
    scanned_total: number | null;
    cost_total: number;
  }>(
    `SELECT t.amount, r.total AS scanned_total, COALESCE(SUM(p.cost), 0) AS cost_total
     FROM transactions t
     LEFT JOIN receipts r ON r.transaction_id = t.id
     LEFT JOIN products p ON p.transaction_id = t.id
     WHERE t.id = $1 AND t.user_id = $2
     GROUP BY t.amount, r.total`,
    [transactionId, userId],
  );
  if (rows.length === 0) return;
  const amount = rows[0].amount ?? null;
  const scanned_total = rows[0].scanned_total ?? null;
  const cost_total = Number(rows[0].cost_total ?? 0);
  const effective = amount ?? scanned_total;
  let status: "ready_to_verify" | "unverified";
  if (
    amount !== null &&
    scanned_total !== null &&
    Math.abs(amount - scanned_total) >= COST_TOLERANCE
  ) {
    status = "unverified"; // manual amount disagrees with the receipt
  } else if (effective === null) {
    status = "unverified"; // nothing to match the product costs against
  } else {
    status =
      Math.abs(cost_total - effective) < COST_TOLERANCE
        ? "ready_to_verify"
        : "unverified";
  }
  await pool.query(
    "UPDATE transactions SET status = $1 WHERE id = $2 AND user_id = $3",
    [status, transactionId, userId],
  );
}

const str = (formData: FormData, key: string): string =>
  ((formData.get(key) as string | null) ?? "").trim();

const nullable = (formData: FormData, key: string): string | null =>
  str(formData, key) || null;

/** Tags arrive as a single comma-separated field; split, trim, drop empties. */
function parseTags(formData: FormData): string[] {
  return str(formData, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** Parse an optional positive number from a form field. Returns `null` when the
 *  field is blank, or an error string when present but not a positive number. */
function parsePositive(
  formData: FormData,
  key: string,
  label: string,
): number | null | { error: string } {
  const raw = str(formData, key);
  if (raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return { error: `${label} must be positive` };
  return n;
}

function parseProductFields(formData: FormData): ProductFields | { error: string } {
  const name = str(formData, "name");
  if (!name) return { error: "Name is required" };

  const cost = parsePositive(formData, "cost", "Cost");
  if (cost !== null && typeof cost === "object") return cost;

  const price = parsePositive(formData, "price", "Price");
  if (price !== null && typeof price === "object") return price;

  const amount = parsePositive(formData, "amount", "Quantity");
  if (amount !== null && typeof amount === "object") return amount;

  return {
    name,
    brand: nullable(formData, "brand"),
    cost,
    product_type: nullable(formData, "product_type"),
    tags: parseTags(formData),
    description: nullable(formData, "description"),
    price,
    amount,
    unit: nullable(formData, "unit"),
  };
}

/** Bulk-insert product line items for a transaction in one round-trip. Shared by
 *  `addProduct` (single item) and the receipt-scan action (many items). The
 *  caller is responsible for verifying transaction ownership and for calling
 *  `recomputeTransactionStatus` afterward. No-op on an empty list. */
export async function insertProducts(
  userId: string,
  transactionId: number,
  items: ProductFields[],
) {
  if (items.length === 0) return;
  const COLS = 11;
  const values: unknown[] = [];
  const rows = items.map((f, i) => {
    const b = i * COLS;
    values.push(
      transactionId,
      userId,
      f.name,
      f.brand,
      f.cost,
      f.product_type,
      f.tags,
      f.description,
      f.price,
      f.amount,
      f.unit,
    );
    return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11})`;
  });
  await pool.query(
    `INSERT INTO products (transaction_id, user_id, name, brand, cost, product_type, tags, description, price, amount, unit)
     VALUES ${rows.join(", ")}`,
    values,
  );
}

export async function addProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const transaction_id = Number(formData.get("transaction_id"));
  if (!Number.isFinite(transaction_id) || transaction_id <= 0)
    return { ok: false, error: "Invalid transaction" };

  const fields = parseProductFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  if (!(await userOwnsTransaction(userId, transaction_id)))
    return { ok: false, error: "Invalid transaction" };

  await insertProducts(userId, transaction_id, [fields]);

  await recomputeTransactionStatus(userId, transaction_id);

  revalidatePath("/transactions");
  return { ok: true };
}

export async function updateProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid product" };

  const fields = parseProductFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  const { rows } = await pool.query<{ transaction_id: number }>(
    `UPDATE products
     SET name = $1, brand = $2, cost = $3, product_type = $4, tags = $5, description = $6,
         price = $7, amount = $8, unit = $9
     WHERE id = $10 AND user_id = $11
     RETURNING transaction_id`,
    [
      fields.name,
      fields.brand,
      fields.cost,
      fields.product_type,
      fields.tags,
      fields.description,
      fields.price,
      fields.amount,
      fields.unit,
      id,
      userId,
    ],
  );

  if (rows[0]) await recomputeTransactionStatus(userId, rows[0].transaction_id);

  revalidatePath("/transactions");
  return { ok: true };
}

export async function deleteProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid product" };

  const { rows } = await pool.query<{ transaction_id: number }>(
    "DELETE FROM products WHERE id = $1 AND user_id = $2 RETURNING transaction_id",
    [id, userId],
  );

  if (rows[0]) await recomputeTransactionStatus(userId, rows[0].transaction_id);

  revalidatePath("/transactions");
  return { ok: true };
}
