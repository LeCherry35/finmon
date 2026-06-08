import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formData, TEST_USER_ID } from "../../test/helpers";

const { scanReceipt, insertProducts, recomputeTransactionStatus, userOwnsTransaction, revalidatePath } =
  vi.hoisted(() => ({
    scanReceipt: vi.fn(),
    insertProducts: vi.fn(),
    recomputeTransactionStatus: vi.fn(),
    userOwnsTransaction: vi.fn(),
    revalidatePath: vi.fn(),
  }));

vi.mock("@/lib/receipt-scan", () => ({ scanReceipt }));
vi.mock("@/actions/products", () => ({ insertProducts, recomputeTransactionStatus }));
vi.mock("@/db/queries", () => ({ userOwnsTransaction }));
vi.mock("@/lib/dal", () => ({ requireUser: vi.fn(async () => ({ id: TEST_USER_ID })) }));
vi.mock("next/cache", () => ({ revalidatePath }));

import { scanReceiptForTransaction } from "@/actions/receipt";

const IMG = "data:image/jpeg;base64,AAAA";

beforeEach(() => {
  scanReceipt.mockReset();
  insertProducts.mockReset();
  recomputeTransactionStatus.mockReset();
  userOwnsTransaction.mockReset().mockResolvedValue(true);
  revalidatePath.mockReset();
});
afterEach(() => vi.clearAllMocks());

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

  it("rejects when the image is missing or not an image data URL", async () => {
    const res = await scanReceiptForTransaction(
      formData({ transaction_id: "42", image: "data:text/plain;base64,AAAA" }),
    );
    expect(res).toEqual({ ok: false, error: "No receipt image provided" });
    expect(scanReceipt).not.toHaveBeenCalled();
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
