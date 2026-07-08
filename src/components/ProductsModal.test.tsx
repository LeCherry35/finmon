// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";
import type { Product } from "@/actions/products";

const { addProduct, updateProduct, deleteProduct, startReceiptScan, scanReceiptForTransaction, updateTransaction } =
  vi.hoisted(() => ({
    addProduct: vi.fn(),
    updateProduct: vi.fn(),
    deleteProduct: vi.fn(),
    startReceiptScan: vi.fn(),
    scanReceiptForTransaction: vi.fn(),
    updateTransaction: vi.fn(),
  }));
vi.mock("@/actions/products", () => ({ addProduct, updateProduct, deleteProduct }));
vi.mock("@/actions/receipt", () => ({ startReceiptScan, scanReceiptForTransaction }));
vi.mock("@/actions/transactions", () => ({ updateTransaction }));

import ProductsModal from "@/components/ProductsModal";

const categories: Category[] = [
  { id: 1, name: "Food", priority: 5 },
  { id: 2, name: "Rent", priority: 9 },
];

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

/** Products are hidden behind the "Show products" toggle now. */
async function revealProducts() {
  await userEvent.click(await screen.findByRole("button", { name: /Show products/ }));
}

beforeEach(() => {
  addProduct.mockReset();
  updateProduct.mockReset();
  deleteProduct.mockReset();
  startReceiptScan.mockReset();
  scanReceiptForTransaction.mockReset();
  updateTransaction.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("ProductsModal", () => {
  it("hides products until the Show products toggle is pressed", async () => {
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);
    expect(screen.queryByText("Oat Milk")).not.toBeInTheDocument();
    await revealProducts();
    expect(await screen.findByText("Oat Milk")).toBeInTheDocument();
  });

  it("links to the stored receipt only when the transaction has one", async () => {
    const { unmount } = render(
      <ProductsModal tx={tx} categories={categories} onClose={() => {}} />,
    );
    await revealProducts();
    expect(screen.queryByRole("link", { name: "View receipt" })).not.toBeInTheDocument();
    unmount();

    render(
      <ProductsModal
        tx={{ ...tx, receipt_id: 7 }}
        categories={categories}
        onClose={() => {}}
      />,
    );
    await revealProducts();
    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute(
      "href",
      "/api/receipts/7",
    );
  });

  it("flags a product/transaction total mismatch (non-blocking)", async () => {
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);
    await revealProducts();
    // products sum 3.50 vs transaction 12.50 — shown as "Total: 3.50 (12.50)"
    expect(
      await screen.findByText(/Total: 3\.50 \(12\.50\)/),
    ).toBeInTheDocument();
  });

  it("edits the transaction and submits the changed fields", async () => {
    updateTransaction.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);

    await userEvent.click(await screen.findByTitle("Edit"));
    const amount = screen.getByLabelText("Amount");
    await userEvent.clear(amount);
    await userEvent.type(amount, "20");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    const fd = updateTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("42");
    expect(fd.get("amount")).toBe("20");
    expect(fd.get("category_id")).toBe("1");
  });

  it("adds a product with the entered fields and the transaction id", async () => {
    addProduct.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);
    await revealProducts();

    // The add form is collapsed until "Add product" is pressed.
    expect(screen.queryByLabelText("Product name")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add product" }));

    await userEvent.type(await screen.findByLabelText("Product name"), "Bread");
    await userEvent.type(screen.getByLabelText("Cost"), "2.2");
    await userEvent.type(screen.getByLabelText("Tags"), "bakery, carbs");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(addProduct).toHaveBeenCalledTimes(1));
    const fd = addProduct.mock.calls[0][0] as FormData;
    expect(fd.get("transaction_id")).toBe("42");
    expect(fd.get("name")).toBe("Bread");
    expect(fd.get("cost")).toBe("2.2");
    expect(fd.get("tags")).toBe("bakery, carbs");
  });

  it("deletes a product after a confirm click", async () => {
    deleteProduct.mockResolvedValue({ ok: true });
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);
    await revealProducts();

    const del = await screen.findByTitle("Delete");
    await userEvent.click(del);
    expect(deleteProduct).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTitle("Click again to confirm"));
    await waitFor(() => expect(deleteProduct).toHaveBeenCalledTimes(1));
    const fd = deleteProduct.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("1");
  });

  it("starts a scan (clears products + marks processing) then fires the vision scan", async () => {
    startReceiptScan.mockResolvedValue({ ok: true });
    scanReceiptForTransaction.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <ProductsModal tx={tx} categories={categories} onClose={() => {}} />,
    );
    await revealProducts();

    // Scan is disabled until an image is staged.
    expect(await screen.findByRole("button", { name: "Scan" })).toBeDisabled();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText(/receipt\.jpg/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Scan" }));

    // phase 1: start (awaited) targets the row
    await waitFor(() => expect(startReceiptScan).toHaveBeenCalledTimes(1));
    expect((startReceiptScan.mock.calls[0][0] as FormData).get("transaction_id")).toBe("42");
    // The background scan is deferred until startReceiptScan's revalidation flips
    // the row to `processing`; it does NOT fire in the same transition.
    expect(scanReceiptForTransaction).not.toHaveBeenCalled();

    // phase 2: simulate the revalidation re-flowing the row as `processing`,
    // which fires the background scan with the staged image.
    rerender(
      <ProductsModal
        tx={{ ...tx, status: "processing" }}
        categories={categories}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(scanReceiptForTransaction).toHaveBeenCalledTimes(1));
    const fd = scanReceiptForTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("transaction_id")).toBe("42");
    expect(String(fd.get("image"))).toMatch(/^data:image\//);
  });

  it("surfaces a start error inline and does not fire the scan", async () => {
    startReceiptScan.mockResolvedValue({ ok: false, error: "A scan is already in progress" });
    render(<ProductsModal tx={tx} categories={categories} onClose={() => {}} />);
    await revealProducts();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "receipt.jpg", { type: "image/jpeg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Scan" }));
    expect(await screen.findByText("A scan is already in progress")).toBeInTheDocument();
    expect(scanReceiptForTransaction).not.toHaveBeenCalled();
  });

  it("blocks scanning while the transaction is already processing", async () => {
    render(
      <ProductsModal
        tx={{ ...tx, status: "processing" }}
        categories={categories}
        onClose={() => {}}
      />,
    );
    await revealProducts();
    const scanBtn = await screen.findByRole("button", { name: "Scanning…" });
    expect(scanBtn).toBeDisabled();
    // even with an image staged, the disabled state holds
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<ProductsModal tx={tx} categories={categories} onClose={onClose} />);
    await userEvent.click(await screen.findByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
