import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { query, clientQuery, release, revalidatePath } = vi.hoisted(() => ({
  query: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
  revalidatePath: vi.fn(),
}));

// `pool.query` for one-shot statements; `pool.connect()` hands back a client for
// the multi-statement delete / set-default transactions.
vi.mock("@/db", () => ({
  pool: { query, connect: vi.fn(async () => ({ query: clientQuery, release })) },
}));
vi.mock("@/lib/dal", () => ({
  requireUser: vi.fn(async () => ({ id: "user-1" })),
}));
vi.mock("next/cache", () => ({ revalidatePath }));

import {
  createCategory,
  deleteCategory,
  setDefaultCategory,
  updateCategory,
} from "@/actions/categories";

const uniqueViolation = Object.assign(new Error("dup"), { code: "23505" });

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  clientQuery.mockResolvedValue({ rows: [], rowCount: 1 });
  release.mockReset();
  revalidatePath.mockReset();
});

/** The SQL of every statement run on the transaction client, in order. */
const clientSql = () => clientQuery.mock.calls.map((c) => c[0] as string);
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

describe("setDefaultCategory", () => {
  it("rejects a bad id without touching the DB", async () => {
    const result = await setDefaultCategory(formData({ id: "0" }));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("clears the old default before setting the new one, in one transaction", async () => {
    const result = await setDefaultCategory(formData({ id: "4" }));
    expect(result).toEqual({ ok: true });

    const sql = clientSql();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toMatch(/SET is_default = FALSE WHERE user_id = \$1 AND is_default/);
    expect(sql[2]).toMatch(/SET is_default = TRUE WHERE id = \$1 AND user_id = \$2/);
    expect(sql[3]).toBe("COMMIT");
    expect(clientQuery.mock.calls[2][1]).toEqual([4, TEST_USER_ID]);
    expect(release).toHaveBeenCalled();
  });

  it("rolls back when the category isn't the user's", async () => {
    clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const result = await setDefaultCategory(formData({ id: "4" }));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(clientSql()).toContain("ROLLBACK");
    expect(clientSql()).not.toContain("COMMIT");
  });
});

describe("deleteCategory", () => {
  /** The is_default lookup `deleteCategoryFor` runs on the pool first. */
  const target = (is_default: boolean) =>
    query.mockResolvedValueOnce({ rows: [{ is_default }], rowCount: 1 });

  it("rejects a bad id without touching the DB", async () => {
    const result = await deleteCategory(formData({ id: "nope" }));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects an unknown or foreign category", async () => {
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const result = await deleteCategory(formData({ id: "4" }));
    expect(result).toEqual({ ok: false, error: "Invalid category" });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("refuses to delete the default category", async () => {
    target(true);
    const result = await deleteCategory(formData({ id: "4" }));
    expect(result).toEqual({
      ok: false,
      error: "That's the default category — make another category the default first",
    });
    expect(clientQuery).not.toHaveBeenCalled();
  });

  it("moves the transactions to the default, drops the plans, then deletes", async () => {
    target(false);
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 }); // default lookup

    const result = await deleteCategory(formData({ id: "4" }));
    expect(result).toEqual({ ok: true });

    const sql = clientSql();
    expect(sql[0]).toBe("BEGIN");
    expect(sql[1]).toMatch(/SELECT id FROM categories WHERE user_id = \$1 AND is_default/);
    expect(sql[2]).toMatch(/UPDATE transactions SET category_id = \$1 WHERE category_id = \$2/);
    expect(clientQuery.mock.calls[2][1]).toEqual([9, 4, TEST_USER_ID]);
    expect(sql[3]).toMatch(/DELETE FROM plans WHERE category_id = \$1 AND user_id = \$2/);
    expect(sql[4]).toMatch(/DELETE FROM categories WHERE id = \$1 AND user_id = \$2/);
    expect(sql[5]).toBe("COMMIT");
    expect(release).toHaveBeenCalled();
  });

  it("creates the default category when the user has none", async () => {
    target(false);
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // no default yet
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 12 }], rowCount: 1 }); // insert

    expect(await deleteCategory(formData({ id: "4" }))).toEqual({ ok: true });

    const sql = clientSql();
    expect(sql[2]).toMatch(/INSERT INTO categories \(name, user_id\)/);
    expect(clientQuery.mock.calls[2][1]).toEqual(["other", TEST_USER_ID]);
    // the new row is flagged, then the transactions move onto it
    expect(sql[3]).toMatch(/SET is_default = TRUE WHERE id = \$1/);
    expect(clientQuery.mock.calls[4][1]).toEqual([12, 4, TEST_USER_ID]);
  });

  it("rolls back and rethrows when a statement fails", async () => {
    target(false);
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // BEGIN
    clientQuery.mockRejectedValueOnce(new Error("boom"));

    await expect(deleteCategory(formData({ id: "4" }))).rejects.toThrow("boom");
    expect(clientSql()).toContain("ROLLBACK");
    expect(release).toHaveBeenCalled();
  });

  it("revalidates every page that groups by category", async () => {
    target(false);
    clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    clientQuery.mockResolvedValueOnce({ rows: [{ id: 9 }], rowCount: 1 });

    await deleteCategory(formData({ id: "4" }));
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining(["/categories", "/transactions", "/plan", "/expenditures", "/charts"]),
    );
  });
});
