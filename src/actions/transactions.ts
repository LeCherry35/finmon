"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";

export type Transaction = {
  id: number;
  amount: number;
  type: "income" | "spend";
  category_id: number;
  date: string;
  note: string | null;
  category_name?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createTransaction(formData: FormData) {
  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const categoryName = ((formData.get("category_name") as string | null) ?? "").trim();
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;

  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive");
  if (!["income", "spend"].includes(type)) throw new Error("Invalid type");
  if (!categoryName) throw new Error("Category is required");
  if (!date) throw new Error("Date is required");
  if (!DATE_RE.test(date)) throw new Error("Date must be YYYY-MM-DD");

  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO categories (name) VALUES ($1)
     ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [categoryName]
  );
  const category_id = rows[0].id;

  await pool.query(
    "INSERT INTO transactions (amount, type, category_id, date, note) VALUES ($1, $2, $3, $4, $5)",
    [amount, type, category_id, date, note]
  );

  revalidatePath("/transactions");
  revalidatePath("/categories");
}

export async function updateTransaction(formData: FormData) {
  const id = Number(formData.get("id"));
  const amount = Number(formData.get("amount"));
  const type = formData.get("type") as string;
  const category_id = Number(formData.get("category_id"));
  const date = ((formData.get("date") as string | null) ?? "").trim();
  const note = ((formData.get("note") as string | null) ?? "").trim() || null;

  if (!Number.isFinite(id) || id <= 0) throw new Error("Invalid transaction");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be positive");
  if (!["income", "spend"].includes(type)) throw new Error("Invalid type");
  if (!category_id) throw new Error("Category is required");
  if (!date) throw new Error("Date is required");
  if (!DATE_RE.test(date)) throw new Error("Date must be YYYY-MM-DD");

  await pool.query(
    "UPDATE transactions SET amount = $1, type = $2, category_id = $3, date = $4, note = $5 WHERE id = $6",
    [amount, type, category_id, date, note, id]
  );

  revalidatePath("/transactions");
}

export async function deleteTransaction(formData: FormData) {
  const id = Number(formData.get("id"));
  await pool.query("DELETE FROM transactions WHERE id = $1", [id]);
  revalidatePath("/transactions");
}
