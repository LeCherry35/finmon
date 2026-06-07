"use server";

import { revalidatePath } from "next/cache";
import { pool } from "@/db";
import { userOwnsTransaction } from "@/db/queries";
import { requireUser } from "@/lib/dal";
import type { ActionResult } from "@/actions/transactions";

export type Product = {
  id: number;
  transaction_id: number;
  name: string;
  brand: string | null;
  cost: number | null;
  product_type: string | null;
  tags: string[];
  description: string | null;
};

/** Parsed-and-validated product fields shared by add/update. `cost` is null when
 *  omitted; only `name` is required. Returns an error string on failure. */
type ProductFields = {
  name: string;
  brand: string | null;
  cost: number | null;
  product_type: string | null;
  tags: string[];
  description: string | null;
};

const str = (formData: FormData, key: string): string =>
  ((formData.get(key) as string | null) ?? "").trim();

const nullable = (formData: FormData, key: string): string | null =>
  str(formData, key) || null;

/** Tags arrive as a single comma-separated field; split, trim, drop empties. */
function parseTags(formData: FormData): string[] {
  return str(formData, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function parseProductFields(formData: FormData): ProductFields | { error: string } {
  const name = str(formData, "name");
  if (!name) return { error: "Name is required" };

  const costRaw = str(formData, "cost");
  let cost: number | null = null;
  if (costRaw !== "") {
    cost = Number(costRaw);
    if (!Number.isFinite(cost) || cost <= 0) return { error: "Cost must be positive" };
  }

  return {
    name,
    brand: nullable(formData, "brand"),
    cost,
    product_type: nullable(formData, "product_type"),
    tags: parseTags(formData),
    description: nullable(formData, "description"),
  };
}

export async function addProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const transaction_id = Number(formData.get("transaction_id"));
  if (!Number.isFinite(transaction_id) || transaction_id <= 0)
    return { ok: false, error: "Invalid transaction" };

  const fields = parseProductFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  if (!(await userOwnsTransaction(userId, transaction_id)))
    return { ok: false, error: "Invalid transaction" };

  await pool.query(
    `INSERT INTO products (transaction_id, user_id, name, brand, cost, product_type, tags, description)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      transaction_id,
      userId,
      fields.name,
      fields.brand,
      fields.cost,
      fields.product_type,
      fields.tags,
      fields.description,
    ],
  );

  revalidatePath("/transactions");
  return { ok: true };
}

export async function updateProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid product" };

  const fields = parseProductFields(formData);
  if ("error" in fields) return { ok: false, error: fields.error };

  await pool.query(
    `UPDATE products
     SET name = $1, brand = $2, cost = $3, product_type = $4, tags = $5, description = $6
     WHERE id = $7 AND user_id = $8`,
    [
      fields.name,
      fields.brand,
      fields.cost,
      fields.product_type,
      fields.tags,
      fields.description,
      id,
      userId,
    ],
  );

  revalidatePath("/transactions");
  return { ok: true };
}

export async function deleteProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();

  const id = Number(formData.get("id"));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: "Invalid product" };

  await pool.query("DELETE FROM products WHERE id = $1 AND user_id = $2", [id, userId]);

  revalidatePath("/transactions");
  return { ok: true };
}
