"use server";

import { revalidatePath } from "next/cache";
import { userOwnsTransaction } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import { scanReceipt } from "@/lib/receipt-scan";
import { insertProducts, recomputeTransactionStatus } from "@/actions/products";
import type { ActionResult } from "@/actions/transactions";

/**
 * Scan a receipt image for an existing transaction and attach the parsed line
 * items as product rows. Used by the create flow (after the transaction is
 * created as `processing`) and by the products modal (existing transactions).
 *
 * The image arrives as a `data:` URL in `image`. On success the parsed products
 * are inserted and the transaction's status is recomputed (it becomes
 * `ready_to_verify` when the product costs sum to `amount`, else `unverified`).
 * On any failure we still recompute so the row never stays stuck on `processing`.
 */
export async function scanReceiptForTransaction(
  formData: FormData,
): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const transactionId = Number(formData.get("transaction_id"));
  if (!Number.isFinite(transactionId) || transactionId <= 0)
    return { ok: false, error: "Invalid transaction" };

  const image = ((formData.get("image") as string | null) ?? "").trim();
  if (!image.startsWith("data:image/"))
    return { ok: false, error: "No receipt image provided" };

  if (!(await userOwnsTransaction(userId, transactionId)))
    return { ok: false, error: "Invalid transaction" };

  try {
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
