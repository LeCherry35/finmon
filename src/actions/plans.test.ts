import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { query, revalidatePath } = vi.hoisted(() => ({
  query: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/dal", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import { upsertPlan } from "@/actions/plans";

beforeEach(() => {
  query.mockReset();
  revalidatePath.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("upsertPlan", () => {
  const valid = { category_id: "3", month: "2026-06", amount: "100" };

  it.each([
    [{ ...valid, category_id: "0" }, "Category is required"],
    [{ ...valid, month: "" }, "Month is required"],
    [{ ...valid, month: "2026-6" }, "Month must be YYYY-MM"],
    [{ ...valid, month: "2026-06-01" }, "Month must be YYYY-MM"],
    [{ ...valid, amount: "0" }, "Amount must be positive"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await upsertPlan(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a category the user does not own", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }); // ownership check
    const result = await upsertPlan(formData(valid));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(query).toHaveBeenCalledTimes(1); // no upsert issued
  });

  it("upserts on (category_id, month) and revalidates on success", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 }) // ownership check
      .mockResolvedValueOnce({}); // upsert
    const result = await upsertPlan(formData(valid));
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/ON CONFLICT \(category_id, month\) DO UPDATE/);
    expect(params).toEqual([3, "2026-06", 100, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/plan");
  });
});
