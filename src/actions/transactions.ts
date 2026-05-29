"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { requireUser } from "@/lib/dal";

export type Transaction = {
  id: number;
  amount: number;
  type: "income" | "spend";
  category_id: number;
  date: string;
  note: string | null;
  category_name?: string;
};

export type ActionResult = { ok: true } | { ok: false; error: string };

export type TransactionFormState = { error?: string; successCount: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createTransaction(
  prevState: TransactionFormState,
  formData: FormData,
): Promise<TransactionFormState> {
  const { id: userId } = await requireUser();

  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const categoryName = ((formData.get("category_name") as string | null) ?? "").trim();
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;

  const fail = (error: string): TransactionFormState => ({
    error,
    successCount: prevState.successCount,
  });

  if (!Number.isFinite(amount) || amount <= 0) return fail("Amount must be positive");
  if (!["income", "spend"].includes(type)) return fail("Invalid type");
  if (!categoryName) return fail("Category is required");
  if (!date) return fail("Date is required");
  if (!DATE_RE.test(date)) return fail("Date must be YYYY-MM-DD");

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO categories (name, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [categoryName, userId]
  );
  const category_id = rows[0].id;

  await pool.query(
    "INSERT INTO transactions (amount, type, category_id, date, note, user_id) VALUES ($1, $2, $3, $4, $5, $6)",
    [amount, type, category_id, date, note, userId]
  );

  revalidatePath("/transactions");
  revalidatePath("/categories");
  return { successCount: prevState.successCount + 1 };
}

export async function updateTransaction(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const category_id = Number(formData.get("category_id"));
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;

  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid transaction" };
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Amount must be positive" };
  if (!["income", "spend"].includes(type)) return { ok: false, error: "Invalid type" };
  if (!Number.isFinite(category_id) || category_id <= 0) return { ok: false, error: "Category is required" };
  if (!date) return { ok: false, error: "Date is required" };
  if (!DATE_RE.test(date)) return { ok: false, error: "Date must be YYYY-MM-DD" };

  const owns = await pool.query(
    "SELECT 1 FROM categories WHERE id = $1 AND user_id = $2",
    [category_id, userId]
  );
  if (owns.rowCount === 0) return { ok: false, error: "Invalid category" };

  await pool.query(
    "UPDATE transactions SET amount = $1, type = $2, category_id = $3, date = $4, note = $5 WHERE id = $6 AND user_id = $7",
    [amount, type, category_id, date, note, id, userId]
  );

  revalidatePath("/transactions");
  return { ok: true };
}

export async function deleteTransaction(formData: FormData) {
  const { id: userId } = await requireUser();
  const id = Number(formData.get("id"));
  await pool.query("DELETE FROM transactions WHERE id = $1 AND user_id = $2", [id, userId]);
  revalidatePath("/transactions");
}
