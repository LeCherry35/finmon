"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import type { ActionResult } from "@/actions/transactions";

export type Category = { id: number; name: string; priority: number };

export type CategoryFormState = { error?: string; successCount: number };

export async function createCategory(
  prevState: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const priorityRaw = ((formData.get("priority") as string | null) ?? "").trim();
  const priority = priorityRaw === "" ? 5 : Number(priorityRaw);

  if (!name)
    return { error: "Name is required", successCount: prevState.successCount };
  if (!Number.isInteger(priority) || priority < 0 || priority > 10)
    return { error: "Priority must be 0–10", successCount: prevState.successCount };

  try {
    await pool.query(
      "INSERT INTO categories (name, priority) VALUES ($1, $2)",
      [name, priority]
    );
  } catch (e) {
    if (isUniqueViolation(e))
      return {
        error: `A category named "${name}" already exists`,
        successCount: prevState.successCount,
      };
    throw e;
  }

  revalidatePath("/categories");
  revalidatePath("/transactions");
  return { successCount: prevState.successCount + 1 };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export async function updateCategory(formData: FormData): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const priority = Number(formData.get("priority"));

  if (!name) return { ok: false, error: "Name is required" };
  if (!Number.isFinite(priority) || priority < 0 || priority > 10)
    return { ok: false, error: "Priority must be 0–10" };

  try {
    await pool.query(
      "UPDATE categories SET name = $1, priority = $2 WHERE id = $3",
      [name, priority, id]
    );
  } catch (e) {
    if (isUniqueViolation(e))
      return { ok: false, error: `A category named "${name}" already exists` };
    throw e;
  }

  revalidatePath("/categories");
  revalidatePath("/transactions");
  return { ok: true };
}

