"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";

export async function upsertPlan(formData: FormData) {
  const category_id = Number(formData.get("category_id"));
  const month = formData.get("month") as string;
  const amount = Number(formData.get("amount"));

  if (amount <= 0) throw new Error("Amount must be positive");
  if (!month) throw new Error("Month is required");
  if (!category_id) throw new Error("Category is required");

  await pool.query(
    `INSERT INTO plans (category_id, month, amount) VALUES ($1, $2, $3)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [category_id, month, amount]
  );

  revalidatePath("/plan");
}
