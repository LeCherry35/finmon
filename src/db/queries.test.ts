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
  getTransactions,
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
    const { sql, params } = lastCall();
    expect(params).toEqual([USER, "2026-06"]);
    expect(sql).not.toMatch(/c\.id = ANY/);
  });

  it("adds a category clause with the correct param index", async () => {
    await getPlansForMonth(USER, "2026-06", [1, 2]);
    const { sql, params } = lastCall();
    expect(params).toEqual([USER, "2026-06", [1, 2]]);
    expect(sql).toMatch(/AND c\.id = ANY\(\$3::int\[\]\)/);
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
    const { sql, params } = lastCall();
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
});

describe("getTransactions", () => {
  it("scopes to the user with no filters", async () => {
    await getTransactions(USER);
    const { sql, params } = lastCall();
    expect(sql).toMatch(/t\.user_id = \$1/);
    expect(sql).toMatch(/ORDER BY t\.date DESC, t\.id DESC/);
    expect(params).toEqual([USER]);
  });

  it("appends month and category filters", async () => {
    await getTransactions(USER, { months: ["2026-06"], categoryIds: [3] });
    const { params } = lastCall();
    expect(params).toEqual([USER, ["2026-06"], [3]]);
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

    for (const [sql, params] of query.mock.calls) {
      expect(sql).toMatch(/user_id = \$1/);
      expect(params[0]).toBe(USER);
    }
  });
});
