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

import { createCategory, updateCategory } from "@/actions/categories";

const uniqueViolation = Object.assign(new Error("dup"), { code: "23505" });

beforeEach(() => {
  query.mockReset();
  revalidatePath.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("createCategory", () => {
  const prev = { successCount: 1 };

  it("requires a name", async () => {
    const result = await createCategory(prev, formData({ name: "  " }));
    expect(result).toEqual({ error: "Name is required", successCount: 1 });
    expect(query).not.toHaveBeenCalled();
  });

  it.each(["-1", "11", "3.5"])(
    "rejects priority %s",
    async (priority) => {
      const result = await createCategory(prev, formData({ name: "Food", priority }));
      expect(result).toEqual({ error: "Priority must be 0–10", successCount: 1 });
      expect(query).not.toHaveBeenCalled();
    },
  );

  it("defaults a blank priority to 5", async () => {
    query.mockResolvedValueOnce({});
    const result = await createCategory(prev, formData({ name: "Food", priority: "" }));
    expect(result).toEqual({ successCount: 2 });
    expect(query.mock.calls[0][1]).toEqual(["Food", 5, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/categories");
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("maps a unique-violation to a friendly error without throwing", async () => {
    query.mockRejectedValueOnce(uniqueViolation);
    const result = await createCategory(prev, formData({ name: "Food", priority: "5" }));
    expect(result).toEqual({
      error: 'A category named "Food" already exists',
      successCount: 1,
    });
  });

  it("rethrows non-unique errors", async () => {
    query.mockRejectedValueOnce(new Error("connection lost"));
    await expect(
      createCategory(prev, formData({ name: "Food", priority: "5" })),
    ).rejects.toThrow("connection lost");
  });
});

describe("updateCategory", () => {
  const valid = { id: "4", name: "Food", priority: "7" };

  it.each([
    [{ ...valid, id: "0" }, "Invalid category"],
    [{ ...valid, name: "" }, "Name is required"],
    [{ ...valid, priority: "11" }, "Priority must be 0–10"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await updateCategory(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("updates scoped by user id on success", async () => {
    query.mockResolvedValueOnce({});
    const result = await updateCategory(formData(valid));
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$3 AND user_id = \$4/);
    expect(params).toEqual(["Food", 7, 4, TEST_USER_ID]);
  });

  it("maps a unique-violation to a friendly error", async () => {
    query.mockRejectedValueOnce(uniqueViolation);
    const result = await updateCategory(formData(valid));
    expect(result).toEqual({
      ok: false,
      error: 'A category named "Food" already exists',
    });
  });
});
