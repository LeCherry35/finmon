// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category } from "@/actions/categories";

// useActionState calls createTransaction(prevState, formData); the receipt hook
// then calls scanReceiptForTransaction. Mock both action modules.
const { createTransaction, scanReceiptForTransaction } = vi.hoisted(() => ({
  createTransaction: vi.fn(),
  scanReceiptForTransaction: vi.fn(),
}));
vi.mock("@/actions/transactions", () => ({ createTransaction }));
vi.mock("@/actions/receipt", () => ({ scanReceiptForTransaction }));

import TransactionCreateForm from "@/components/TransactionCreateForm";

const categories: Category[] = [{ id: 1, name: "Food", priority: 5 }];

function renderForm() {
  return render(<TransactionCreateForm categories={categories} today="2026-06-01" />);
}

function fileInput(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

beforeEach(() => {
  createTransaction.mockReset().mockResolvedValue({ successCount: 1, lastTxId: 55 });
  scanReceiptForTransaction.mockReset().mockResolvedValue({ ok: true });
});
afterEach(() => vi.clearAllMocks());

// Generous timeout: these tests run a real file upload + canvas/FileReader
// downscale under jsdom, which can exceed the 5s default when the whole suite
// runs in parallel on a slow machine.
describe("TransactionCreateForm receipt scanning", { timeout: 15_000 }, () => {
  it("shows 'Add' until a receipt is staged, then 'Scan & add'", async () => {
    const { container } = renderForm();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();

    const file = new File(["x"], "receipt.jpg", { type: "image/jpeg" });
    await userEvent.upload(fileInput(container), file);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Scan & add" })).toBeInTheDocument(),
    );
  });

  it("creates the transaction with has_receipt, then fires a scan for the new row", async () => {
    const { container } = renderForm();

    await userEvent.type(screen.getByPlaceholderText("Amount"), "30");
    await userEvent.type(screen.getByPlaceholderText("Category"), "Food");
    await userEvent.upload(
      fileInput(container),
      new File(["x"], "receipt.jpg", { type: "image/jpeg" }),
    );

    await userEvent.click(await screen.findByRole("button", { name: "Scan & add" }));

    // createTransaction got the form fields + the has_receipt flag
    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    const createFd = createTransaction.mock.calls[0][1] as FormData;
    expect(createFd.get("amount")).toBe("30");
    expect(createFd.get("has_receipt")).toBe("1");

    // ...and the follow-up scan targets the returned row with the image data URL
    await waitFor(() => expect(scanReceiptForTransaction).toHaveBeenCalledTimes(1));
    const scanFd = scanReceiptForTransaction.mock.calls[0][0] as FormData;
    expect(scanFd.get("transaction_id")).toBe("55");
    expect(String(scanFd.get("image"))).toMatch(/^data:image\//);
  });

  it("does not scan when no receipt was staged", async () => {
    renderForm();
    await userEvent.type(screen.getByPlaceholderText("Amount"), "30");
    await userEvent.type(screen.getByPlaceholderText("Category"), "Food");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    expect(createTransaction.mock.calls[0][1].get("has_receipt")).toBe("");
    expect(scanReceiptForTransaction).not.toHaveBeenCalled();
  });
});
