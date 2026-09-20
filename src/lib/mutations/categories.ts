import "server-only";
import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import type { QueryResult, QueryResultRow } from "pg";
import type { ActionResult } from "@/actions/transactions";
import { DEFAULT_CATEGORY_NAME } from "@/lib/categories";

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

/** The paths whose data changes when a category is deleted or the default
 *  moves: the list itself, plus everything that groups by category. */
function revalidateCategoryPages() {
  revalidatePath("/categories");
  revalidatePath("/transactions");
  revalidatePath("/plan");
  revalidatePath("/expenditures");
  revalidatePath("/charts");
}

/** Minimal surface shared by `pool` and a checked-out client, so the helpers
 *  below can run either standalone or inside someone else's transaction. */
type Queryable = {
  query<R extends QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>>;
};

/** The user's default category id, creating it if they have none. Every user
 *  gets one lazily — migration 021 seeded existing users, and anyone who
 *  registers later lands here on their first delete or receipt scan.
 *
 *  The insert upserts on `(user_id, name)` so a user who already has a
 *  category literally named "other" adopts it instead of failing. */
export async function ensureDefaultCategoryFor(
  userId: string,
  db: Queryable = pool,
): Promise<number> {
  const { rows: existing } = await db.query<{ id: number }>(
    "SELECT id FROM categories WHERE user_id = $1 AND is_default",
    [userId],
  );
  if (existing[0]) return existing[0].id;

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO categories (name, user_id) VALUES ($1, $2)
     ON CONFLICT (user_id, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [DEFAULT_CATEGORY_NAME, userId],
  );
  const id = rows[0].id;
  await db.query("UPDATE categories SET is_default = TRUE WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  revalidatePath("/categories");
  return id;
}

/** Makes `id` the user's default category. Clearing the old default first is
 *  required — `categories_one_default_per_user` (migration 021) allows only
 *  one flagged row per user. */
export async function setDefaultCategoryFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid category" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "UPDATE categories SET is_default = FALSE WHERE user_id = $1 AND is_default",
      [userId],
    );
    const { rowCount } = await client.query(
      "UPDATE categories SET is_default = TRUE WHERE id = $1 AND user_id = $2",
      [id, userId],
    );
    if (!rowCount) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Invalid category" };
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  revalidateCategoryPages();
  return { ok: true };
}

/** Deletes a category, moving its transactions onto the user's default
 *  category and dropping its monthly plans. The default itself can't be
 *  deleted — there would be nowhere for its own transactions to go — so the
 *  user promotes another category first.
 *
 *  `transactions.category_id` is `ON DELETE RESTRICT`, so the reassign has to
 *  happen in the same transaction as the delete (and that FK stays as a
 *  backstop: no other path can orphan a transaction). */
export async function deleteCategoryFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid category" };

  const { rows: target } = await pool.query<{ is_default: boolean }>(
    "SELECT is_default FROM categories WHERE id = $1 AND user_id = $2",
    [id, userId],
  );
  if (!target[0]) return { ok: false, error: "Invalid category" };
  if (target[0].is_default)
    return {
      ok: false,
      error: "That's the default category — make another category the default first",
    };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const fallback = await ensureDefaultCategoryFor(userId, client);
    await client.query(
      "UPDATE transactions SET category_id = $1 WHERE category_id = $2 AND user_id = $3",
      [fallback, id, userId],
    );
    await client.query("DELETE FROM plans WHERE category_id = $1 AND user_id = $2", [id, userId]);
    await client.query("DELETE FROM categories WHERE id = $1 AND user_id = $2", [id, userId]);
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  revalidateCategoryPages();
  return { ok: true };
}
