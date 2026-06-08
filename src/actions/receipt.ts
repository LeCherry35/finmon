"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsTransaction } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import { scanReceipt } from "@/lib/receipt-scan";
import { insertProducts, recomputeTransactionStatus } from "@/actions/products";
import type { ActionResult } from "@/actions/transactions";

/**
 * Begin a (re)scan from the products modal: clear the transaction's existing
 * products — a new scan replaces them — and mark it `processing` so the row
 * reads as "scanning" while the follow-up `scanReceiptForTransaction` runs. The
 * status update is guarded (`status <> 'processing'`), so a transaction that is
 * already mid-scan can't be scanned again (a no-op update → friendly error).
 *
 * The create flow doesn't use this: `createTransaction` already starts the row
 * `processing` and the row has no products to clear.
 */
export async function startReceiptScan(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const transactionId = Number(formData.get("transaction_id"));
  if (!Number.isFinite(transactionId) || transactionId <= 0)
    return { ok: false, error: "Invalid transaction" };

  if (!(await userOwnsTransaction(userId, transactionId)))
    return { ok: false, error: "Invalid transaction" };

  const { rowCount } = await pool.query(
    "UPDATE transactions SET status = 'processing' WHERE id = $1 AND user_id = $2 AND status <> 'processing'",
    [transactionId, userId],
  );
  if (rowCount === 0) return { ok: false, error: "A scan is already in progress" };

  // A new scan replaces the previous products.
  await pool.query(
    "DELETE FROM products WHERE transaction_id = $1 AND user_id = $2",
    [transactionId, userId],
  );

  revalidatePath("/transactions");
  return { ok: true };
}

/**
 * Scan a receipt image for an existing transaction and attach the parsed line
 * items as product rows. Used by the create flow (after the transaction is
 * created as `processing`) and by the products modal (after `startReceiptScan`).
 *
 * The image arrives as a `data:` URL in `image`. On success the parsed products
 * are inserted and the transaction's status is recomputed (it becomes
 * `ready_to_verify` when the product costs sum to `amount`, else `unverified`).
 * On any failure we still recompute so the row never stays stuck on `processing`.
 *
 * Once the transaction is known to be valid and owned, the rest of the work —
 * including the image-format check — runs inside the `try`, so EVERY failure
 * path hits the `finally` recompute. (A bad/missing image was previously an
 * early `return` before the `try`, which left a row the create flow had already
 * marked `processing` stuck there forever.)
 */
export async function scanReceiptForTransaction(
  formData: FormData,
): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const transactionId = Number(formData.get("transaction_id"));
  if (!Number.isFinite(transactionId) || transactionId <= 0)
    return { ok: false, error: "Invalid transaction" };

  if (!(await userOwnsTransaction(userId, transactionId)))
    return { ok: false, error: "Invalid transaction" };

  try {
    const image = ((formData.get("image") as string | null) ?? "").trim();
    if (!image.startsWith("data:image/"))
      throw new Error("No receipt image provided");

    const { products } = await scanReceipt(image);
    await insertProducts(userId, transactionId, products);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Receipt scan failed",
    };
  } finally {
    // Always re-derive status: on success it reflects the new products; on
    // failure it clears a 'processing' row back to 'unverified' (0 products vs
    // a positive amount), so nothing is left stuck mid-scan.
    await recomputeTransactionStatus(userId, transactionId);
    revalidatePath("/transactions");
  }
}
