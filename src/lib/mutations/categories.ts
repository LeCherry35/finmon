import "server-only";
import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import type { ActionResult } from "@/actions/transactions";

// Category write logic, keyed by an explicit `userId` — shared by the "use
// server" actions in src/actions/categories.ts and the agent's proposal-apply
// path. Never export these from a "use server" module.

export async function createCategoryFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const priorityRaw = ((formData.get("priority") as string | null) ?? "").trim();
  const priority = priorityRaw === "" ? 5 : Number(priorityRaw);

  if (!name) return { ok: false, error: "Name is required" };
  if (!Number.isInteger(priority) || priority < 0 || priority > 10)
    return { ok: false, error: "Priority must be 0–10" };

  try {
    await pool.query(
      "INSERT INTO categories (name, priority, user_id) VALUES ($1, $2, $3)",
      [name, priority, userId]
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

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export async function updateCategoryFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  const name = ((formData.get("name") as string | null) ?? "").trim();
  const priority = Number(formData.get("priority"));

  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid category" };
  if (!name) return { ok: false, error: "Name is required" };
  if (!Number.isFinite(priority) || priority < 0 || priority > 10)
    return { ok: false, error: "Priority must be 0–10" };

  try {
    await pool.query(
      "UPDATE categories SET name = $1, priority = $2 WHERE id = $3 AND user_id = $4",
      [name, priority, id, userId]
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
