import "server-only";
import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsCategory } from "@/db/queries";
import { MONTH_RE } from "@/lib/filters";
import type { ActionResult } from "@/actions/transactions";

// Plan write logic, keyed by an explicit `userId` — shared by the "use server"
// upsertPlan action and the agent's proposal-apply path. Never export this from
// a "use server" module.

export async function upsertPlanFor(
  userId: string,
  formData: FormData,
): Promise<ActionResult> {
  const category_id = Number(formData.get("category_id"));
  const month = ((formData.get("month") as string | null) ?? "").trim();
  const amountRaw = ((formData.get("amount") as string | null) ?? "").trim();

  if (!Number.isFinite(category_id) || category_id <= 0) return { ok: false, error: "Category is required" };
  if (!month) return { ok: false, error: "Month is required" };
  if (!MONTH_RE.test(month)) return { ok: false, error: "Month must be YYYY-MM" };
  // 0 is a valid plan ("budget nothing here"); reject only blank or negative.
  // Parse the trimmed string, not Number(get()) directly, so blank ("" → 0)
  // isn't silently accepted as a zero plan.
  if (amountRaw === "") return { ok: false, error: "Amount is required" };
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0)
    return { ok: false, error: "Amount must be zero or more" };

  if (!(await userOwnsCategory(userId, category_id)))
    return { ok: false, error: "Invalid category" };

  await pool.query(
    `INSERT INTO plans (category_id, month, amount, user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (category_id, month) DO UPDATE SET amount = EXCLUDED.amount`,
    [category_id, month, amount, userId]
  );

  revalidatePath("/plan");
  return { ok: true };
}
