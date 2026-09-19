import "server-only";
import { pool } from "@/db";

/** Store (or replace) the receipt photo of a transaction — one per transaction.
 *  `total` is the scanned grand total when already known; a new image without
 *  one resets it to NULL, since the old total described the old photo. The
 *  caller verifies the transaction belongs to `userId`. */
export async function upsertReceipt(
  userId: string,
  transactionId: number,
  image: { bytes: Buffer; contentType: string },
  total: number | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO receipts (transaction_id, user_id, image, content_type, total)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (transaction_id)
     DO UPDATE SET image = EXCLUDED.image, content_type = EXCLUDED.content_type,
                   created_at = now(), total = EXCLUDED.total`,
    [transactionId, userId, image.bytes, image.contentType, total],
  );
}
