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
    const products = [{ name: "Milk", cost: 2.5, tags: [] }];
    scanReceipt.mockResolvedValueOnce({ store: "Tesco", total: 2.5, products });

    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: IMG }),
    );

    expect(res).toEqual({ ok: true });
    expect(scanReceipt).toHaveBeenCalledWith(IMG);
    expect(insertProducts).toHaveBeenCalledWith(TEST_USER_ID, 42, products);
    expect(recomputeTransactionStatus).toHaveBeenCalledWith(TEST_USER_ID, 42);
    expect(revalidatePath).toHaveBeenCalledWith("/transactions");
  });

  it("stores the receipt image via upsert before the vision call", async () => {
    scanReceipt.mockResolvedValueOnce({ store: null, total: null, products: [] });

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO receipts/);
    expect(sql).toMatch(/ON CONFLICT \(transaction_id\)/); // re-scan replaces
    expect(params).toEqual([
      42,
      TEST_USER_ID,
      Buffer.from("AAAA", "base64"),
      "image/jpeg",
    ]);
  });

  it("stores the image even when the scan itself fails", async () => {
    scanReceipt.mockRejectedValueOnce(new Error("boom"));

    await scanReceiptForTransaction(formData({ transaction_id: "42", image: IMG }));

    expect(query.mock.calls[0][0]).toMatch(/INSERT INTO receipts/);
  });

  it("a failed image store is logged but does not abort the scan", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    query.mockRejectedValueOnce(new Error("disk full")); // the receipts upsert
    const products = [{ name: "Milk", cost: 2.5, tags: [] }];
    scanReceipt.mockResolvedValueOnce({ store: null, total: null, products });

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
