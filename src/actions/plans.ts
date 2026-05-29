"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { requireUser } from "@/lib/dal";
import { MONTH_RE } from "@/lib/filters";
import type { ActionResult } from "@/actions/transactions";

export async function upsertPlan(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const category_id = Number(formData.get("category_id"));
  const month = ((formData.get("month") as string | null) ?? "").trim();
  const amount = Number(formData.get("amount"));

  if (!Number.isFinite(category_id) || category_id <= 0) return { ok: false, error: "Category is required" };
  if (!month) return { ok: false, error: "Month is required" };
  if (!MONTH_RE.test(month)) return { ok: false, error: "Month must be YYYY-MM" };
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Amount must be positive" };

  const owns = await pool.query(
    "SELECT 1 FROM categories WHERE id = $1 AND user_id = $2",
    [category_id, userId]
  );
  if (owns.rowCount === 0) return { ok: false, error: "Invalid category" };

  await pool.query(
    `INSERT INTO plans (category_id, month, amount, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [category_id, month, amount, userId]
  );

  revalidatePath("/plan");
  return { ok: true };
}
