"use server";

import { requireUser } from "@/lib/dal";
import {
  addProductFor,
  deleteProductFor,
  updateProductFor,
} from "@/lib/mutations/products";
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
  price: number | null;
  amount: number | null;
  unit: string | null;
  /** Money taken off this line. `cost` is the final amount paid AFTER the
   *  discount — this field is informational, not subtracted again. */
  discount: number | null;
};

/** Parsed-and-validated product fields shared by add/update. Numeric fields are
 *  null when omitted; only `name` is required. `amount` is the quantity. Returns
 *  an error string on failure. Also produced by the receipt scanner
 *  (`src/lib/receipt-scan.ts`) and consumed by `insertProducts`. */
export type ProductFields = {
  name: string;
  brand: string | null;
  cost: number | null;
  product_type: string | null;
  tags: string[];
  description: string | null;
  price: number | null;
  amount: number | null;
  unit: string | null;
  discount: number | null;
};

// Thin wrappers: resolve the signed-in user, then delegate to the shared write
// logic in src/lib/mutations/products.ts.

export async function addProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return addProductFor(userId, formData);
}

export async function updateProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return updateProductFor(userId, formData);
}

export async function deleteProduct(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return deleteProductFor(userId, formData);
}
