import "server-only";
import { pool } from "@/db";
import { ensureDefaultCategoryFor } from "@/lib/mutations/categories";
import { insertProducts } from "@/lib/mutations/products";
import { isPlausibleScanDate, type ScanResult } from "@/lib/receipt-scan";
import { convertScanToBase } from "@/lib/currency";

/** The stored receipt photo of a transaction, with the latest scan of it. */
export type StoredReceipt = {
  id: number;
  image: Buffer;
  content_type: string;
  scan: ScanResult | null;
};

/** Store (or replace) the receipt photo of a transaction — one per transaction.
 *  `total` and `scan` are the scanned grand total and line items when already
 *  known; a new image without them resets both to NULL, since the old scan
 *  described the old photo. The caller verifies the transaction belongs to
 *  `userId`. */
export async function upsertReceipt(
  userId: string,
  transactionId: number,
  image: { bytes: Buffer; contentType: string },
  total: number | null = null,
  scan: ScanResult | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO receipts (transaction_id, user_id, image, content_type, total, scan)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (transaction_id)
     DO UPDATE SET image = EXCLUDED.image, content_type = EXCLUDED.content_type,
                   created_at = now(), total = EXCLUDED.total, scan = EXCLUDED.scan,
                   currency = 'UAH', original_total = NULL, exchange_rate = NULL`,
    [transactionId, userId, image.bytes, image.contentType, total, scan && JSON.stringify(scan)],
  );
}

/** A transaction's stored receipt, or null when it has none. */
export async function getStoredReceipt(
  userId: string,
  transactionId: number,
): Promise<StoredReceipt | null> {
  const { rows } = await pool.query<StoredReceipt>(
    `SELECT id, image, content_type, scan FROM receipts
     WHERE transaction_id = $1 AND user_id = $2`,
    [transactionId, userId],
  );
  return rows[0] ?? null;
}

/** Cache the latest scan of a transaction's stored photo, so the user's Accept
 *  applies exactly what the agent read (mirrors `agent_attachments.scan`). */
export async function saveReceiptScan(
  userId: string,
  transactionId: number,
  scan: ScanResult,
): Promise<void> {
  await pool.query(
    "UPDATE receipts SET scan = $1 WHERE transaction_id = $2 AND user_id = $3",
    [JSON.stringify(scan), transactionId, userId],
  );
}

/**
 * Write a scan onto a transaction: the grand total goes to `receipts.total`,
 * blank transaction fields are filled in from the scan (category — matched
 * against the user's category names, falling back to their default category —
 * store, and a still-default date), and the parsed line items are inserted as
 * products. A manually entered `amount` is never touched. A USD/EUR scan is
 * converted to UAH at the transaction's final date first (`convertScanToBase`;
 * no rate → `CurrencyError`).
 *
 * The date rule: the create form always submits a date defaulting to today, so
 * a scanned date only replaces a still-today date (i.e. the user kept the
 * default), and an implausible one is dropped entirely.
 *
 * `categories` is the user's category list (the same one the scan was given),
 * used to resolve the scanned category name. The caller verifies the
 * transaction belongs to `userId` and recomputes its status afterwards
 * (`recomputeTransactionStatus`).
 */
export async function applyScanToTransaction(
  userId: string,
  transactionId: number,
  scan: ScanResult,
  categories: { id: number; name: string }[],
): Promise<void> {
  const { store, date, category } = scan;

  // Category: the scan answers with one of the user's category names or the
  // literal "other" — resolve to an id, falling back to the user's default
  // category (created on the spot if they have none).
  let scannedCategoryId: number | null = null;
  if (category !== null) {
    const { rows: existing } = await pool.query<{ category_id: number | null }>(
      "SELECT category_id FROM transactions WHERE id = $1 AND user_id = $2",
      [transactionId, userId],
    );
    if (existing[0] && existing[0].category_id === null) {
      const match = categories.find((c) => c.name === category);
      scannedCategoryId = match ? match.id : await ensureDefaultCategoryFor(userId);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  // A date far from today is almost certainly a misread (wrong year, etc.) —
  // drop it so the transaction keeps its date instead.
  let scannedDate = date;
  if (scannedDate !== null && !isPlausibleScanDate(scannedDate, today)) {
    console.warn(`Ignoring implausible scanned date ${scannedDate} for transaction ${transactionId}`);
    scannedDate = null;
  }
  const { rows: updated } = await pool.query<{ date: string }>(
    `UPDATE transactions
     SET category_id = COALESCE(category_id, $1),
         store       = COALESCE(store, $2),
         date        = CASE WHEN $3::text IS NOT NULL AND date = $4 THEN $3::text ELSE date END
     WHERE id = $5 AND user_id = $6
     RETURNING date`,
    [scannedCategoryId, store, scannedDate, today, transactionId, userId],
  );

  // A USD/EUR receipt is converted to UAH at the rate of the transaction's
  // (now final) date before anything money-related is stored.
  const converted = await convertScanToBase(scan, updated[0]?.date ?? today);

  // The receipt's grand total (the final amount paid, discounts already
  // reflected) lives on the receipt row, never on transactions.amount — a
  // manually entered amount stays authoritative and the status recompute
  // compares the two. No-ops when no receipts row exists (a failed image store,
  // already logged).
  await setReceiptTotal(userId, transactionId, converted);

  await insertProducts(userId, transactionId, converted.scan.products);
}

/** Store a converted scan's UAH total, and its printed original when foreign. */
export async function setReceiptTotal(
  userId: string,
  transactionId: number,
  c: Awaited<ReturnType<typeof convertScanToBase>>,
): Promise<void> {
  await pool.query(
    `UPDATE receipts SET total = $1, currency = $2, original_total = $3, exchange_rate = $4
     WHERE transaction_id = $5 AND user_id = $6`,
    [c.scan.total, c.currency, c.rate === null ? null : c.original_total, c.rate, transactionId, userId],
  );
}

/** A re-scan replaces the previous line items. */
export async function deleteTransactionProducts(userId: string, transactionId: number): Promise<void> {
  await pool.query("DELETE FROM products WHERE transaction_id = $1 AND user_id = $2", [
    transactionId,
    userId,
  ]);
}
