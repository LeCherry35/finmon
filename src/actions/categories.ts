"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";

export type Category = { id: number; name: string; priority: number };

export async function createCategory(formData: FormData) {
  const name = (formData.get("name") as string).trim();
  const priority = Number(formData.get("priority"));

  if (!name) throw new Error("Name is required");
  if (priority < 0 || priority > 10) throw new Error("Priority must be 0–10");

  await pool.query(
    "INSERT INTO categories (name, priority) VALUES ($1, $2)",
    [name, priority]
  );

  revalidatePath("/categories");
  revalidatePath("/transactions");
}

export async function updateCategory(formData: FormData) {
  const id = Number(formData.get("id"));
  const name = (formData.get("name") as string).trim();
  const priority = Number(formData.get("priority"));

  if (!name) throw new Error("Name is required");
  if (priority < 0 || priority > 10) throw new Error("Priority must be 0–10");

  await pool.query(
    "UPDATE categories SET name = $1, priority = $2 WHERE id = $3",
    [name, priority, id]
  );

  revalidatePath("/categories");
  revalidatePath("/transactions");
}

export async function deleteCategory(formData: FormData) {
  const id = Number(formData.get("id"));
  await pool.query("DELETE FROM categories WHERE id = $1", [id]);
  revalidatePath("/categories");
  revalidatePath("/transactions");
}
