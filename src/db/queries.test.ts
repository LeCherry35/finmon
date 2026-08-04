import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db", () => ({ pool: { query } }));

import {
  getAvailableMonths,
  getCategories,
  getExpendituresByCategory,
  getExpenditureSeries,
  getPlansForMonth,
  getPlansSummary,
  getReceiptImage,
  getTransactions,
  userOwnsCategory,
} from "@/db/queries";

const USER = "user-1";

/** SQL + params of the last pool.query call. */
function lastCall(): { sql: string; params: unknown[] } {
  const [sql, params] = query.mock.calls.at(-1)!;
  return { sql, params };
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});
afterEach(() => vi.clearAllMocks());

describe("getCategories", () => {
  it("scopes to the user and orders by priority then name", async () => {
    await getCategories(USER);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/WHERE user_id = \$1/);
    expect(sql).toMatch(/ORDER BY priority DESC, name ASC/);
    expect(params).toEqual([USER]);
  });
});

describe("getAvailableMonths", () => {
  it("scopes to the user and maps rows to month strings", async () => {
    query.mockResolvedValueOnce({ rows: [{ month: "2026-06" }, { month: "2026-05" }] });
    const months = await getAvailableMonths(USER);
    expect(months).toEqual(["2026-06", "2026-05"]);
    expect(lastCall().params).toEqual([USER]);
  });
});

describe("getPlansForMonth", () => {
  it("omits the category clause when no ids are given", async () => {
    await getPlansForMonth(USER, "2026-06");
    // calls[0] is the main plan query (a second query fetches uncategorized spend)
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([USER, "2026-06"]);
    expect(sql).not.toMatch(/c\.id = ANY/);
  });

  it("adds a category clause with the correct param index", async () => {
    await getPlansForMonth(USER, "2026-06", [1, 2]);
    const { sql, params } = lastCall();
    expect(params).toEqual([USER, "2026-06", [1, 2]]);
    expect(sql).toMatch(/AND c\.id = ANY\(\$3::int\[\]\)/);
  });

  it("appends an Uncategorized row when uncategorized spend exists and no filter", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ category_id: 1, category_name: "Food", plan_id: 9, amount: 100, spent: 30 }] }) // main
      .mockResolvedValueOnce({ rows: [{ spent: 42 }] }); // uncategorized spend
    const rows = await getPlansForMonth(USER, "2026-06");
    expect(rows.at(-1)).toEqual({
      category_id: 0,
      category_name: "Uncategorized",
      plan_id: null,
      amount: null,
      spent: 42,
    });
    // the helper query is user-scoped and targets category-less spend
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/t\.category_id IS NULL/);
    expect(params).toEqual([USER, ["2026-06"]]);
  });

  it("omits the Uncategorized row when there is no uncategorized spend", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ category_id: 1, category_name: "Food", plan_id: 9, amount: 100, spent: 30 }] })
      .mockResolvedValueOnce({ rows: [{ spent: 0 }] });
    const rows = await getPlansForMonth(USER, "2026-06");
    expect(rows.some((r) => r.category_id === 0)).toBe(false);
  });

  it("does not query uncategorized spend when a category filter is active", async () => {
    await getPlansForMonth(USER, "2026-06", [1, 2]);
    expect(query).toHaveBeenCalledTimes(1); // main query only
  });
});

describe("getPlansSummary", () => {
  it("short-circuits to [] for no months without querying", async () => {
    const result = await getPlansSummary(USER, []);
    expect(result).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("filters plans and spend by the month list, scoped to the user", async () => {
    await getPlansSummary(USER, ["2026-05", "2026-06"]);
    // calls[0] is the main summary query (a second fetches uncategorized spend)
    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual([USER, ["2026-05", "2026-06"]]);
    expect(sql).toMatch(/month = ANY\(\$2::text\[\]\)/);
    expect(sql).toMatch(/type = 'spend'/);
  });

  it("appends a category clause at the next param index", async () => {
    await getPlansSummary(USER, ["2026-06"], [4]);
    const { sql, params } = lastCall();
    expect(params).toEqual([USER, ["2026-06"], [4]]);
    expect(sql).toMatch(/AND c\.id = ANY\(\$3::int\[\]\)/);
  });

  it("appends an Uncategorized summary row when uncategorized spend exists", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ category_id: 1, category_name: "Food", amount: 100, spent: 30 }] })
      .mockResolvedValueOnce({ rows: [{ spent: 15 }] });
    const rows = await getPlansSummary(USER, ["2026-06"]);
    expect(rows.at(-1)).toEqual({
      category_id: 0,
      category_name: "Uncategorized",
      amount: 0,
      spent: 15,
    });
  });

  it("does not query uncategorized spend when a category filter is active", async () => {
    await getPlansSummary(USER, ["2026-06"], [4]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe("getExpendituresByCategory", () => {
  it("always filters to the user's spend transactions", async () => {
    await getExpendituresByCategory(USER);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/t\.user_id = \$1/);
    expect(sql).toMatch(/t\.type = 'spend'/);
    expect(params).toEqual([USER]);
  });

  it("appends month then category filters with sequential indexes", async () => {
    await getExpendituresByCategory(USER, { months: ["2026-06"], categoryIds: [1, 2] });
    const { sql, params } = lastCall();
    expect(params).toEqual([USER, ["2026-06"], [1, 2]]);
    expect(sql).toMatch(/LEFT\(t\.date, 7\) = ANY\(\$2::text\[\]\)/);
    expect(sql).toMatch(/t\.category_id = ANY\(\$3::int\[\]\)/);
  });

  it("LEFT JOINs categories and buckets null category as Uncategorized", async () => {
    await getExpendituresByCategory(USER);
    const { sql } = lastCall();
    expect(sql).toMatch(/LEFT JOIN categories c/);
    expect(sql).toMatch(/COALESCE\(c\.name, 'Uncategorized'\)/);
  });
});

describe("getExpenditureSeries", () => {
  it("short-circuits to [] for no months", async () => {
    expect(await getExpenditureSeries(USER, [], null, "day")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("buckets by full date in day granularity", async () => {
    await getExpenditureSeries(USER, ["2026-06"], null, "day");
    const { sql, params } = lastCall();
    expect(sql).toMatch(/t\.date AS bucket/);
    expect(params).toEqual([USER, ["2026-06"]]);
  });

  it("buckets by month and adds a category clause in month granularity", async () => {
    await getExpenditureSeries(USER, ["2026-06"], [9], "month");
    const { sql, params } = lastCall();
    expect(sql).toMatch(/LEFT\(t\.date, 7\) AS bucket/);
    expect(sql).toMatch(/AND t\.category_id = ANY\(\$3::int\[\]\)/);
    expect(params).toEqual([USER, ["2026-06"], [9]]);
  });

  it("LEFT JOINs categories so uncategorized spend forms its own series", async () => {
    await getExpenditureSeries(USER, ["2026-06"], null, "day");
    const { sql } = lastCall();
    expect(sql).toMatch(/LEFT JOIN categories c/);
    expect(sql).toMatch(/COALESCE\(c\.name, 'Uncategorized'\)/);
    expect(sql).toMatch(/COALESCE\(c\.priority, -1\)/);
  });
});

describe("getReceiptImage", () => {
  it("returns the user-scoped image row when it exists", async () => {
    const row = { image: Buffer.from("x"), content_type: "image/jpeg" };
    query.mockResolvedValueOnce({ rows: [row] });
    expect(await getReceiptImage(USER, 7)).toEqual(row);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/FROM receipts WHERE user_id = \$1 AND id = \$2/);
    expect(params).toEqual([USER, 7]);
  });

  it("returns null when the receipt is missing or belongs to another user", async () => {
    expect(await getReceiptImage(USER, 7)).toBeNull();
  });
});

describe("getTransactions", () => {
  it("scopes to the user, left-joins the receipt id, with no filters", async () => {
    await getTransactions(USER);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/t\.user_id = \$1/);
    expect(sql).toMatch(/LEFT JOIN receipts r ON r\.transaction_id = t\.id/);
    expect(sql).toMatch(/r\.id AS receipt_id/);
    expect(sql).toMatch(/ORDER BY t\.date DESC, t\.id DESC/);
    expect(params).toEqual([USER]);
  });

  it("sorts by insertion order (id) when sort is 'added'", async () => {
    await getTransactions(USER, {}, "added");
    const { sql } = lastCall();
    expect(sql).toMatch(/ORDER BY t\.id DESC/);
    expect(sql).not.toMatch(/t\.date DESC/);
  });

  it("appends month and category filters", async () => {
    await getTransactions(USER, { months: ["2026-06"], categoryIds: [3] });
    // The category/month clause params are on the first (transactions) query;
    // with the default empty-rows mock no products round-trip is made.
    const [, params] = query.mock.calls[0];
    expect(params).toEqual([USER, ["2026-06"], [3]]);
  });

  it("attaches each transaction's products in a second user-scoped query", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // transactions
      .mockResolvedValueOnce({
        rows: [
          { id: 10, transaction_id: 1, name: "other" },
          { id: 11, transaction_id: 1, name: "milk" },
          { id: 12, transaction_id: 2, name: "other" },
        ],
      }); // products

    const txs = await getTransactions(USER);

    const { sql, params } = lastCall();
    expect(sql).toMatch(/FROM products WHERE user_id = \$1 AND transaction_id = ANY\(\$2::int\[\]\)/);
    expect(params).toEqual([USER, [1, 2]]);
    expect(txs[0].products?.map((p) => p.name)).toEqual(["other", "milk"]);
    expect(txs[1].products?.map((p) => p.name)).toEqual(["other"]);
  });
});

describe("userOwnsCategory", () => {
  it("returns true and scopes the lookup to the user when a row matches", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 });
    expect(await userOwnsCategory(USER, 3)).toBe(true);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/FROM categories WHERE id = \$1 AND user_id = \$2/);
    expect(params).toEqual([3, USER]);
  });

  it("returns false when no row matches", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 });
    expect(await userOwnsCategory(USER, 3)).toBe(false);
  });
});

describe("tenancy", () => {
  it("every query is scoped by user_id = $1", async () => {
    await getCategories(USER);
    await getAvailableMonths(USER);
    await getPlansForMonth(USER, "2026-06");
    await getPlansSummary(USER, ["2026-06"]);
    await getExpendituresByCategory(USER);
    await getExpenditureSeries(USER, ["2026-06"], null, "day");
    await getTransactions(USER);
    await getReceiptImage(USER, 1);

    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/user_id = \$1/);
      expect(params[0]).toBe(USER);
    }
  });
});
