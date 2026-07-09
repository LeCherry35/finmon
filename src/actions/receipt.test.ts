import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { query, scanReceipt, insertProducts, recomputeTransactionStatus, userOwnsTransaction, revalidatePath } =
  vi.hoisted(() => ({
    query: vi.fn(),
    scanReceipt: vi.fn(),
    insertProducts: vi.fn(),
    recomputeTransactionStatus: vi.fn(),
    userOwnsTransaction: vi.fn(),
    revalidatePath: vi.fn(),
  }));

vi.mock("@/db", () => ({ pool: { query } }));
vi.mock("@/lib/receipt-scan", () => ({ scanReceipt }));
vi.mock("@/actions/products", () => ({ insertProducts, recomputeTransactionStatus }));
vi.mock("@/db/queries", () => ({ userOwnsTransaction }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: TEST_USER_ID })) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { startReceiptScan, scanReceiptForTransaction } from "@/actions/receipt";

const IMG = "data:image/jpeg;base64,AAAA";

/** A full ScanResult with everything absent — override what a test cares about. */
function scanResult(overrides: Record<string, unknown> = {}) {
  return { store: null, total: null, date: null, category: null, products: [], ...overrides };
}

/** Route the pool.query mock by SQL shape so tests don't depend on call order.
 *  `categories` seeds the user's category list; `txCategoryId` is what the
 *  writeback pre-read finds on the transaction. */
function primeQueries({
  categories = [] as { id: number; name: string }[],
  txCategoryId = null as number | null,
  otherId = 99,
} = {}) {
  query.mockImplementation(async (sql: string) => {
    if (/INSERT INTO receipts/.test(sql)) return { rowCount: 1 };
    if (/SELECT id, name FROM categories/.test(sql)) return { rows: categories };
    if (/UPDATE receipts SET total/.test(sql)) return { rowCount: 1 };
    if (/SELECT category_id FROM transactions/.test(sql)) return { rows: [{ category_id: txCategoryId }] };
    if (/INSERT INTO categories/.test(sql)) return { rows: [{ id: otherId }] };
    return { rows: [], rowCount: 1 };
  });
}

/** The single writeback UPDATE on transactions (category/store/date fill-in). */
function writebackCall() {
  return query.mock.calls.find(([sql]) => /UPDATE transactions\s+SET category_id/.test(sql));
}

beforeEach(() => {
  query.mockReset();
  scanReceipt.mockReset();
  insertProducts.mockReset();
  recomputeTransactionStatus.mockReset();
  userOwnsTransaction.mockReset().mockResolvedValue(true);
  revalidatePath.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("startReceiptScan", () => {
  it("marks the transaction processing, clears its products, and revalidates", async () => {
    query
      .mockResolvedValueOnce({ rowCount: 1 }) // guarded status update
      .mockResolvedValueOnce({}); // delete products

    const res = await startReceiptScan(formData({ transaction_id: "42" }));

    expect(res).toEqual({ ok: true });
    const [statusSql, statusParams] = query.mock.calls[0];
    expect(statusSql).toMatch(/SET status = 'processing'/);
    expect(statusSql).toMatch(/status <> 'processing'/); // guard
    expect(statusParams).toEqual([42, TEST_USER_ID]);
    const [delSql, delParams] = query.mock.calls[1];
    expect(delSql).toMatch(/DELETE FROM products/);
    expect(delParams).toEqual([42, TEST_USER_ID]);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("refuses to start when a scan is already in progress (guard no-op)", async () => {
    query.mockResolvedValueOnce({ rowCount: 0 }); // already processing → no row updated

    const res = await startReceiptScan(formData({ transaction_id: "42" }));

    expect(res).toEqual({ ok: false, error: "A scan is already in progress" });
    // did not delete products
    expect(query).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects an invalid id and an unowned transaction without touching the db", async () => {
    expect(await startReceiptScan(formData({ transaction_id: "0" }))).toEqual({
      ok: false,
      error: "Invalid transaction",
    });
    userOwnsTransaction.mockResolvedValueOnce(false);
    expect(await startReceiptScan(formData({ transaction_id: "42" }))).toEqual({
      ok: false,
      error: "Invalid transaction",
    });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("scanReceiptForTransaction", () => {
  it("scans, inserts the parsed products, recomputes status, and revalidates", async () => {
    primeQueries();
    const products = [{ name: "Milk", cost: 2.5, tags: [] }];
    scanReceipt.mockResolvedValueOnce(scanResult({ store: "Tesco", total: 2.5, products }));

    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: IMG }),
    );

    expect(res).toEqual({ ok: true });
    expect(scanReceipt).toHaveBeenCalledWith(IMG, []);
    expect(insertProducts).toHaveBeenCalledWith(TEST_USER_ID, 42, products);
    expect(recomputeTransactionStatus).toHaveBeenCalledWith(TEST_USER_ID, 42);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("passes the user's category names to the scan", async () => {
    primeQueries({
      categories: [
        { id: 1, name: "groceries" },
        { id: 2, name: "transport" },
      ],
    });
    scanReceipt.mockResolvedValueOnce(scanResult());

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    expect(scanReceipt).toHaveBeenCalledWith(IMG, ["groceries", "transport"]);
  });

  it("stores the receipt image via upsert (resetting total) before the vision call", async () => {
    primeQueries();
    scanReceipt.mockResolvedValueOnce(scanResult());

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO receipts/);
    expect(sql).toMatch(/ON CONFLICT \(transaction_id\)/); // re-scan replaces
    expect(sql).toMatch(/total = NULL/); // a new image invalidates the old total
    expect(params).toEqual([
      42,
      TEST_USER_ID,
      Buffer.from("AAAA", "base64"),
      "image/jpeg",
    ]);
  });

  it("stores the scanned grand total on the receipt row", async () => {
    primeQueries();
    scanReceipt.mockResolvedValueOnce(scanResult({ total: 17.4 }));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    const totalCall = query.mock.calls.find(([sql]) => /UPDATE receipts SET total/.test(sql));
    expect(totalCall).toBeDefined();
    expect(totalCall![1]).toEqual([17.4, 42, TEST_USER_ID]);
  });

  it("fills a blank category from an exact scanned-name match, never touching amount", async () => {
    primeQueries({ categories: [{ id: 7, name: "groceries" }], txCategoryId: null });
    scanReceipt.mockResolvedValueOnce(scanResult({ store: "Tesco", category: "groceries" }));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    const [sql, params] = writebackCall()!;
    expect(sql).toMatch(/COALESCE\(category_id, \$1\)/);
    expect(sql).toMatch(/COALESCE\(store, \$2\)/);
    expect(sql).not.toMatch(/amount/); // manual amount stays authoritative
    expect(params[0]).toBe(7);
    expect(params[1]).toBe("Tesco");
    // matched an existing category → no 'other' upsert
    expect(query.mock.calls.some(([s]) => /INSERT INTO categories/.test(s))).toBe(false);
  });

  it("lazily creates the per-user 'other' category when the scan falls back", async () => {
    primeQueries({ categories: [{ id: 7, name: "groceries" }], txCategoryId: null, otherId: 99 });
    scanReceipt.mockResolvedValueOnce(scanResult({ category: "other" }));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    const upsert = query.mock.calls.find(([s]) => /INSERT INTO categories/.test(s));
    expect(upsert).toBeDefined();
    expect(upsert![0]).toMatch(/'other'/);
    expect(upsert![0]).toMatch(/ON CONFLICT \(user_id, name\)/);
    expect(upsert![1]).toEqual([TEST_USER_ID]);
    expect(writebackCall()![1][0]).toBe(99);
    expect(revalidatePath).toHaveBeenCalledWith("/categories");
  });

  it("does not resolve or overwrite a category the transaction already has", async () => {
    primeQueries({ categories: [{ id: 7, name: "groceries" }], txCategoryId: 5 });
    scanReceipt.mockResolvedValueOnce(scanResult({ category: "other" }));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    expect(query.mock.calls.some(([s]) => /INSERT INTO categories/.test(s))).toBe(false);
    // COALESCE(category_id, NULL) — a no-op for the already-set category
    expect(writebackCall()![1][0]).toBeNull();
  });

  it("overwrites a still-default (today) date with the scanned one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-08T12:00:00Z"));
    try {
      primeQueries();
      scanReceipt.mockResolvedValueOnce(scanResult({ date: "2026-07-01" }));

      await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

      const [sql, params] = writebackCall()!;
      // scanned date replaces the date only while it still equals today
      expect(sql).toMatch(/CASE WHEN \$3::text IS NOT NULL AND date = \$4 THEN \$3::text ELSE date END/);
      expect(params[2]).toBe("2026-07-01");
      expect(params[3]).toBe("2026-07-08");
    } finally {
      vi.useRealTimers();
    }
  });

  it("stores the image even when the scan itself fails", async () => {
    primeQueries();
    scanReceipt.mockRejectedValueOnce(new Error("boom"));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO receipts/);
  });

  it("a failed image store is logged but does not abort the scan", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    primeQueries();
    query.mockRejectedValueOnce(new Error("disk full")); // the receipts upsert
    const products = [{ name: "Milk", cost: 2.5, tags: [] }];
    scanReceipt.mockResolvedValueOnce(scanResult({ products }));

    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: IMG }),
    );

    expect(res).toEqual({ ok: true });
    expect(insertProducts).toHaveBeenCalledWith(TEST_USER_ID, 42, products);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it.each([
    ["0", IMG],
    ["-3", IMG],
    ["x", IMG],
  ])("rejects an invalid transaction id (%s)", async (id) => {
    const res = await scanReceiptForTransaction(formData({ transaction_id: id, image: IMG }));
    expect(res).toEqual({ ok: false, error: "Invalid transaction" });
    expect(userOwnsTransaction).not.toHaveBeenCalled();
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  it("rejects a bad image but still recomputes (clears 'processing') for an owned tx", async () => {
    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: "data:text/plain;base64,AAAA" }),
    );
    expect(res).toEqual({ ok: false, error: "No receipt image provided" });
    expect(scanReceipt).not.toHaveBeenCalled();
    // The create flow already marked the row 'processing'; a bad image must not
    // leave it stuck there, so the recompute still runs in `finally`.
    expect(recomputeTransactionStatus).toHaveBeenCalledWith(TEST_USER_ID, 42);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("rejects a transaction the user does not own", async () => {
    userOwnsTransaction.mockResolvedValueOnce(false);
    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: IMG }),
    );
    expect(res).toEqual({ ok: false, error: "Invalid transaction" });
    expect(scanReceipt).not.toHaveBeenCalled();
  });

  it("on scan failure returns the error but still recomputes (clears 'processing') and revalidates", async () => {
    primeQueries();
    scanReceipt.mockRejectedValueOnce(new Error("OpenAI request failed (500): boom"));

    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: IMG }),
    );

    expect(res).toEqual({ ok: false, error: "OpenAI request failed (500): boom" });
    expect(insertProducts).not.toHaveBeenCalled();
    // recompute + revalidate run in `finally` so the row never stays processing
    expect(recomputeTransactionStatus).toHaveBeenCalledWith(TEST_USER_ID, 42);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });
});
