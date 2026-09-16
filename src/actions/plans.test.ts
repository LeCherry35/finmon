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

import { seedPlansFromPreviousMonth, upsertPlan } from "@/actions/plans";

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
    [{ ...valid, amount: "" }, "Amount is required"],
    [{ ...valid, amount: "-5" }, "Amount must be zero or more"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await upsertPlan(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("accepts a plan of 0 (budget nothing here)", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 }) // ownership check
      .mockResolvedValueOnce({}); // upsert
    const result = await upsertPlan(formData({ ...valid, amount: "0" }));
    expect(result).toEqual({ ok: true });
    const [, params] = query.mock.calls[1];
    expect(params).toEqual([3, "2026-06", 0, TEST_USER_ID]);
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

describe("seedPlansFromPreviousMonth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("copies the latest earlier month's plans into an empty current month", async () => {
    query.mockResolvedValueOnce({ rowCount: 3 });
    await seedPlansFromPreviousMonth("2026-09");
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO plans/);
    expect(sql).toMatch(/SELECT MAX\(month\) FROM plans WHERE user_id = \$1 AND month < \$2/);
    expect(sql).toMatch(/NOT EXISTS \(SELECT 1 FROM plans WHERE user_id = \$1 AND month = \$2\)/);
    expect(sql).toMatch(/ON CONFLICT \(category_id, month\) DO NOTHING/);
    expect(params).toEqual([TEST_USER_ID, "2026-09"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("seeds a future month too", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    await seedPlansFromPreviousMonth("2026-10");
    expect(query).toHaveBeenCalledTimes(1);
  });

  it.each(["2026-08", "2025-12", "2026-9", "bogus"])("skips past or invalid month %s", async (month) => {
    await seedPlansFromPreviousMonth(month);
    expect(query).not.toHaveBeenCalled();
  });

  it("logs and swallows a DB failure", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error("db down"));
    await expect(seedPlansFromPreviousMonth("2026-09")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
