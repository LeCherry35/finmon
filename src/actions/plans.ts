"use server";

import { pool } from "@/db";
import { requireUser } from "@/lib/dal";
import { upsertPlanFor } from "@/lib/mutations/plans";
import { MONTH_RE, currentMonth } from "@/lib/filters";
import type { ActionResult } from "@/actions/transactions";

export async function upsertPlan(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return upsertPlanFor(userId, formData);
}

/** Carry plans over into a month that has none yet: copies the amounts from the
 *  most recent earlier month with plans (so a skipped month still carries).
 *  Called by the /plan page while rendering, so it never revalidates and never
 *  throws. Only current/future months are seeded — browsing an old empty month
 *  must not backfill history — and a month with even one saved plan is left
 *  alone (NOT EXISTS), so a user's edits are never overwritten. */
export async function seedPlansFromPreviousMonth(month: string): Promise<void> {
  const { id: userId } = await requireUser();
  if (!MONTH_RE.test(month) || month < currentMonth()) return;

  try {
    await pool.query(
      `INSERT INTO plans (category_id, month, amount, user_id)
       SELECT p.category_id, $2, p.amount, p.user_id
       FROM plans p
       WHERE p.user_id = $1
         AND p.month = (SELECT MAX(month) FROM plans WHERE user_id = $1 AND month < $2)
         AND NOT EXISTS (SELECT 1 FROM plans WHERE user_id = $1 AND month = $2)
       ON CONFLICT (category_id, month) DO NOTHING`,
      [userId, month],
    );
  } catch (err) {
    console.error(
      `Plan carry-over failed for ${month}:`,
      err instanceof Error ? err.stack ?? err.message : err,
    );
  }
}
