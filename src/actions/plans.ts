"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { MONTH_RE } from "@/lib/filters";
import type { ActionResult } from "@/actions/transactions";

export async function upsertPlan(formData: FormData): Promise<ActionResult> {
  const category_id = Number(formData.get("category_id"));
  const month = ((formData.get("month") as string | null) ?? "").trim();
  const amount = Number(formData.get("amount"));

  if (!category_id) return { ok: false, error: "Category is required" };
  if (!month) return { ok: false, error: "Month is required" };
  if (!MONTH_RE.test(month)) return { ok: false, error: "Month must be YYYY-MM" };
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Amount must be positive" };

  await pool.query(
    `INSERT INTO plans (category_id, month, amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [category_id, month, amount]
  );

  revalidatePath("/plan");
  return { ok: true };
}
