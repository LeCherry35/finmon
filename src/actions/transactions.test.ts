import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

// `query` backs both pool.query and the pooled client's query, so call order
// across pool + client is a single sequence on this one mock.
const { query, release, revalidatePath } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/db", () => ({
  pool: { query, connect: vi.fn(async () => ({ query, release })) },
}));
vi.mock("@/lib/dal", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
} from "@/actions/transactions";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  revalidatePath.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("createTransaction", () => {
  const prev = { successCount: 2 };

  it.each([
    [{ amount: "0", type: "spend", category_name: "Food", date: "2026-06-01" }, "Amount must be positive"],
    [{ amount: "x", type: "spend", category_name: "Food", date: "2026-06-01" }, "Amount must be positive"],
    [{ amount: "10", type: "bogus", category_name: "Food", date: "2026-06-01" }, "Invalid type"],
    [{ amount: "10", type: "spend", category_name: "", date: "2026-06-01" }, "Category is required"],
    [{ amount: "10", type: "spend", category_name: "Food", date: "" }, "Date is required"],
    [{ amount: "10", type: "spend", category_name: "Food", date: "06/01/2026" }, "Date must be YYYY-MM-DD"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await createTransaction(prev, formData(fields));
    expect(result).toEqual({ error, successCount: 2 });
    expect(query).not.toHaveBeenCalled();
  });

  it("upserts the category, inserts the row + default product, and revalidates on success", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // category upsert (pool)
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // transaction insert RETURNING id
      .mockResolvedValueOnce({}) // product insert
      .mockResolvedValueOnce({}); // COMMIT

    const result = await createTransaction(
      prev,
      formData({
        amount: "12.5",
        type: "spend",
        category_name: " Food ",
        date: "2026-06-01",
        note: "lunch",
      }),
    );

    expect(result).toEqual({ successCount: 3 });
    // exactly: category upsert + BEGIN + transaction INSERT + product INSERT + COMMIT
    expect(query).toHaveBeenCalledTimes(5);
    // category upsert: trimmed name + user id
    expect(query.mock.calls[0][1]).toEqual(["Food", TEST_USER_ID]);
    // transaction insert: amount, type, category_id, date, note, user id
    expect(query.mock.calls[2][1]).toEqual([
      12.5,
      "spend",
      7,
      "2026-06-01",
      "lunch",
      TEST_USER_ID,
    ]);
    // default product 'other' mirrors the amount, scoped to the new transaction
    const [productSql, productParams] = query.mock.calls[3];
    expect(productSql).toMatch(/INSERT INTO products/);
    expect(productSql).toMatch(/'other'/);
    expect(productParams).toEqual([42, TEST_USER_ID, 12.5]);
    expect(release).toHaveBeenCalled();
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
    expect(revalidatePath).toHaveBeenCalledWith("/categories");
  });

  it("stores an empty note as null", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // category upsert
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 5 }] }) // transaction insert
      .mockResolvedValueOnce({}) // product insert
      .mockResolvedValueOnce({}); // COMMIT
    await createTransaction(
      prev,
      formData({ amount: "5", type: "income", category_name: "Pay", date: "2026-06-01" }),
    );
    // transaction insert is the 3rd query call; note is param index 4
    expect(query.mock.calls[2][1][4]).toBeNull();
  });
});

describe("updateTransaction", () => {
  const valid = {
    id: "5",
    amount: "10",
    type: "spend",
    category_id: "3",
    date: "2026-06-01",
  };

  it.each([
    [{ ...valid, id: "0" }, "Invalid transaction"],
    [{ ...valid, amount: "-1" }, "Amount must be positive"],
    [{ ...valid, type: "nope" }, "Invalid type"],
    [{ ...valid, category_id: "0" }, "Category is required"],
    [{ ...valid, date: "" }, "Date is required"],
    [{ ...valid, date: "2026/06/01" }, "Date must be YYYY-MM-DD"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await updateTransaction(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a category the user does not own", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }); // ownership check
    const result = await updateTransaction(formData(valid));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(query).toHaveBeenCalledTimes(1); // no UPDATE issued
  });

  it("updates scoped by user id on success", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 }) // ownership check
      .mockResolvedValueOnce({}); // update
    const result = await updateTransaction(formData(valid));
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/WHERE id = \$6 AND user_id = \$7/);
    expect(params).toEqual([10, "spend", 3, "2026-06-01", null, 5, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });
});

describe("deleteTransaction", () => {
  it("deletes scoped by user id and revalidates", async () => {
    query.mockResolvedValueOnce({});
    await deleteTransaction(formData({ id: "9" }));
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND user_id = \$2/);
    expect(params).toEqual([9, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  // TO_FIX: deleteTransaction does not validate the id before querying, unlike
  // its siblings. Pin the desired behavior here once the guard is added.
  it.todo("rejects a non-positive / NaN id without querying");
});
