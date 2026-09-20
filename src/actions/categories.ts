"use server";

import { requireUser } from "@/lib/dal";
import {
  createCategoryFor,
  deleteCategoryFor,
  setDefaultCategoryFor,
  updateCategoryFor,
} from "@/lib/mutations/categories";
import type { ActionResult } from "@/actions/transactions";

export type Category = {
  id: number;
  name: string;
  priority: number;
  /** The user's fallback category: deleted categories' transactions land here,
   *  and it can't itself be deleted. Exactly one per user. */
  is_default: boolean;
};

export type CategoryFormState = { error?: string; successCount: number };

// Thin wrappers: resolve the signed-in user, then delegate to the shared write
// logic in src/lib/mutations/categories.ts.

export async function createCategory(
  prevState: CategoryFormState,
  formData: FormData,
): Promise<CategoryFormState> {
  const { id: userId } = await requireUser();
  const result = await createCategoryFor(userId, formData);
  if (!result.ok) return { error: result.error, successCount: prevState.successCount };
  return { successCount: prevState.successCount + 1 };
}

export async function updateCategory(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return updateCategoryFor(userId, formData);
}

export async function setDefaultCategory(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return setDefaultCategoryFor(userId, formData);
}

export async function deleteCategory(formData: FormData): Promise<ActionResult> {
  const { id: userId } = await requireUser();
  return deleteCategoryFor(userId, formData);
}
