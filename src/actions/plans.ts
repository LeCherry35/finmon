"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { MONTH_RE } from "@/lib/filters";

export async function upsertPlan(formData: FormData) {
  const category_id = Number(formData.get("category_id"));
  const month = ((formData.get("month") as string | null) ?? "").trim();
  const amount = Number(formData.get("amount"));

  if (!category_id) throw new Error("Category is required");
  if (!month) throw new Error("Month is required");
  if (!MONTH_RE.test(month)) throw new Error("Month must be YYYY-MM");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive");

  await pool.query(
    `INSERT INTO plans (category_id, month, amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [category_id, month, amount]
  );

  revalidatePath("/plan");
}
