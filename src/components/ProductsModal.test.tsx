// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/actions/transactions";
import type { Product } from "@/actions/products";

const { addProduct, updateProduct, deleteProduct, scanReceiptForTransaction } = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
  scanReceiptForTransaction: vi.fn(),
}));
vi.mock("@/actions/products", () => ({ addProduct, updateProduct, deleteProduct }));
vi.mock("@/actions/receipt", () => ({ scanReceiptForTransaction }));

import ProductsModal from "@/components/ProductsModal";

const product: Product = {
  id: 1,
  transaction_id: 42,
  name: "Oat Milk",
  brand: "Oatly",
  cost: 3.5,
  product_type: "milk",
  tags: ["vegan", "breakfast"],
  description: "barista edition",
  price: 1.75,
  amount: 2,
  unit: "L",
};

const tx: Transaction = {
  id: 42,
  amount: 12.5,
  type: "spend",
  category_id: 1,
  date: "2026-06-01",
  note: "lunch",
  store: "Tesco",
  status: "unverified",
  category_name: "Food",
  products: [product],
};

beforeEach(() => {
  addProduct.mockReset();
  updateProduct.mockReset();
  deleteProduct.mockReset();
  scanReceiptForTransaction.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("ProductsModal", () => {
  it("renders the transaction's existing products", async () => {
    render(<ProductsModal tx={tx} onClose={() => {}} />);
    expect(await screen.findByText("Oat Milk")).toBeInTheDocument();
    expect(screen.getByText("vegan")).toBeInTheDocument();
    expect(screen.getByText("breakfast")).toBeInTheDocument();
  });

  it("flags a product/transaction total mismatch (non-blocking)", async () => {
    render(<ProductsModal tx={tx} onClose={() => {}} />);
    // products sum 3.50 vs transaction 12.50
    expect(
      await screen.findByText(/don't match \(that's allowed\)/i),
    ).toBeInTheDocument();
  });

  it("adds a product with the entered fields and the transaction id", async () => {
    addProduct.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} onClose={() => {}} />);

    await userEvent.type(await screen.findByLabelText("Product name"), "Bread");
    await userEvent.type(screen.getByLabelText("Cost"), "2.2");
    await userEvent.type(screen.getByLabelText("Tags"), "bakery, carbs");
    await userEvent.click(screen.getByRole("button", { name: "Add product" }));

    await waitFor(() => expect(addProduct).toHaveBeenCalledTimes(1));
    const fd = addProduct.mock.calls[0][0] as FormData;
    expect(fd.get("transaction_id")).toBe("42");
    expect(fd.get("name")).toBe("Bread");
    expect(fd.get("cost")).toBe("2.2");
    expect(fd.get("tags")).toBe("bakery, carbs");
  });

  it("deletes a product after a confirm click", async () => {
    deleteProduct.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} onClose={() => {}} />);

    const del = await screen.findByTitle("Delete");
    await userEvent.click(del);
    expect(deleteProduct).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTitle("Click again to confirm"));
    await waitFor(() => expect(deleteProduct).toHaveBeenCalledTimes(1));
    const fd = deleteProduct.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("1");
  });

  it("scans an uploaded receipt for the transaction", async () => {
    scanReceiptForTransaction.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} onClose={() => {}} />);

    // Scan is disabled until an image is staged.
    expect(await screen.findByRole("button", { name: "Scan" })).toBeDisabled();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText(/receipt\.jpg/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Scan" }));

    await waitFor(() => expect(scanReceiptForTransaction).toHaveBeenCalledTimes(1));
    const fd = scanReceiptForTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("transaction_id")).toBe("42");
    expect(String(fd.get("image"))).toMatch(/^data:image\//);
  });

  it("surfaces a scan error inline", async () => {
    scanReceiptForTransaction.mockResolvedValue({ ok: false, error: "Receipt scan failed" });
    render(<ProductsModal tx={tx} onClose={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Scan" }));
    expect(await screen.findByText("Receipt scan failed")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<ProductsModal tx={tx} onClose={onClose} />);
    await userEvent.click(await screen.findByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
