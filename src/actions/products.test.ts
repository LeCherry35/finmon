import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { query, revalidatePath, userOwnsTransaction } = vi.hoisted(() => ({
  query: vi.fn(),
  revalidatePath: vi.fn(),
  userOwnsTransaction: vi.fn(),
}));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/db/queries", () => ({ userOwnsTransaction }));
vi.mock("@/lib/dal", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  addProduct,
  updateProduct,
  deleteProduct,
  recomputeTransactionStatus,
} from "@/actions/products";

beforeEach(() => {
  query.mockReset();
  revalidatePath.mockReset();
  userOwnsTransaction.mockReset();
  // Default return covers the recompute round-trip that every mutation runs
  // after its primary query (a SELECT returning amount/total, then an UPDATE),
  // and supplies the `transaction_id` that update/delete read via RETURNING.
  query.mockResolvedValue({ rows: [{ transaction_id: 9, amount: 0, total: 0 }] });
});
afterEach(() => vi.clearAllMocks());

describe("addProduct", () => {
  const valid = { transaction_id: "5", name: "Milk" };

  it.each([
    [{ ...valid, transaction_id: "0" }, "Invalid transaction"],
    [{ ...valid, transaction_id: "x" }, "Invalid transaction"],
    [{ ...valid, name: "" }, "Name is required"],
    [{ ...valid, cost: "0" }, "Cost must be positive"],
    [{ ...valid, cost: "-3" }, "Cost must be positive"],
    [{ ...valid, cost: "abc" }, "Cost must be positive"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await addProduct(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a transaction the user does not own", async () => {
    userOwnsTransaction.mockResolvedValueOnce(false);
    const result = await addProduct(formData(valid));
    expect(result).toEqual({ ok: false, error: "Invalid transaction" });
    expect(query).not.toHaveBeenCalled();
  });

  it("inserts the product scoped to the user and revalidates", async () => {
    userOwnsTransaction.mockResolvedValueOnce(true);
    const result = await addProduct(
      formData({
        transaction_id: "5",
        name: " Oat Milk ",
        brand: " Oatly ",
        cost: "3.50",
        product_type: " milk ",
        tags: "vegan, breakfast, ",
        description: " barista edition ",
        price: "1.75",
        amount: "2",
        unit: " L ",
        discount: "0.50",
      }),
    );
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO products/);
    // transaction_id, user_id, name, brand, cost, product_type, tags, description, price, amount, unit, discount
    expect(params).toEqual([
      5,
      TEST_USER_ID,
      "Oat Milk",
      "Oatly",
      3.5,
      "milk",
      ["vegan", "breakfast"],
      "barista edition",
      1.75,
      2,
      "L",
      0.5,
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("treats omitted optional fields as null and empty tags", async () => {
    userOwnsTransaction.mockResolvedValueOnce(true);
    await addProduct(formData({ transaction_id: "5", name: "Bread" }));
    const params = query.mock.calls[0][1];
    expect(params).toEqual([
      5,
      TEST_USER_ID,
      "Bread",
      null,
      null,
      null,
      [],
      null,
      null,
      null,
      null,
      null,
    ]);
  });
});

describe("updateProduct", () => {
  it.each([
    [{ id: "0", name: "X" }, "Invalid product"],
    [{ id: "5", name: "" }, "Name is required"],
    [{ id: "5", name: "X", cost: "-1" }, "Cost must be positive"],
    [{ id: "5", name: "X", discount: "0" }, "Discount must be positive"],
  ])("rejects invalid input (%o)", async (fields, error) => {
    const result = await updateProduct(formData(fields));
    expect(result).toEqual({ ok: false, error });
    expect(query).not.toHaveBeenCalled();
  });

  it("updates scoped by user id and revalidates", async () => {
    const result = await updateProduct(
      formData({ id: "9", name: "Eggs", cost: "4", tags: "protein" }),
    );
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$11 AND user_id = \$12/);
    expect(params).toEqual([
      "Eggs",
      null,
      4,
      null,
      ["protein"],
      null,
      null,
      null,
      null,
      null,
      9,
      TEST_USER_ID,
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });
});

describe("recomputeTransactionStatus", () => {
  // Runs the recompute against a single mocked SELECT row and returns the
  // status it wrote (cost_total arrives as a string — NUMERIC SUM via COALESCE
  // is not covered by the global float parser in every branch, so the code
  // Number()s it).
  async function statusFor(row: {
    amount: number | null;
    scanned_total: number | null;
    cost_total: string;
  }): Promise<string> {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({});
    await recomputeTransactionStatus(TEST_USER_ID, 9);
    expect(query).toHaveBeenCalledTimes(2);
    return query.mock.calls[1][1][0];
  }

  it("is ready_to_verify when costs sum to the manual amount", async () => {
    expect(await statusFor({ amount: 30, scanned_total: null, cost_total: "30" })).toBe("ready_to_verify");
  });

  it("is unverified when costs miss the manual amount", async () => {
    expect(await statusFor({ amount: 30, scanned_total: null, cost_total: "12" })).toBe("unverified");
  });

  it("falls back to the scanned receipt total when there is no manual amount", async () => {
    expect(await statusFor({ amount: null, scanned_total: 30, cost_total: "30" })).toBe("ready_to_verify");
  });

  it("a manual amount that disagrees with the scanned total blocks ready_to_verify", async () => {
    // costs match the manual amount, but the receipt says otherwise
    expect(await statusFor({ amount: 30, scanned_total: 45, cost_total: "30" })).toBe("unverified");
  });

  it("is unverified when there is nothing to match costs against", async () => {
    expect(await statusFor({ amount: null, scanned_total: null, cost_total: "30" })).toBe("unverified");
  });

  it("does nothing for a missing/foreign transaction", async () => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [] });
    await recomputeTransactionStatus(TEST_USER_ID, 9);
    expect(query).toHaveBeenCalledTimes(1); // no status UPDATE
  });
});

describe("deleteProduct", () => {
  it.each([
    [{ id: "0" }],
    [{ id: "x" }],
  ])("rejects an invalid id without querying (%o)", async (fields) => {
    const result = await deleteProduct(formData(fields));
    expect(result).toEqual({ ok: false, error: "Invalid product" });
    expect(query).not.toHaveBeenCalled();
  });

  it("deletes scoped by user id and revalidates", async () => {
    const result = await deleteProduct(formData({ id: "9" }));
    expect(result).toEqual({ ok: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id = \$1 AND user_id = \$2/);
    expect(params).toEqual([9, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });
});
