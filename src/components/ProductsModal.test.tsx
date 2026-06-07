// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/actions/transactions";
import type { Product } from "@/actions/products";

const { addProduct, updateProduct, deleteProduct } = vi.hoisted(() => ({
  addProduct: vi.fn(),
  updateProduct: vi.fn(),
  deleteProduct: vi.fn(),
}));
vi.mock("@/actions/products", () => ({ addProduct, updateProduct, deleteProduct }));

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
};

const tx: Transaction = {
  id: 42,
  amount: 12.5,
  type: "spend",
  category_id: 1,
  date: "2026-06-01",
  note: "lunch",
  category_name: "Food",
  products: [product],
};

beforeEach(() => {
  addProduct.mockReset();
  updateProduct.mockReset();
  deleteProduct.mockReset();
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

  it("shows the selected filename for the mock upload", async () => {
    render(<ProductsModal tx={tx} onClose={() => {}} />);
    const input = (await screen.findByText("Upload receipt"))
      .closest("div")!
      .querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["x"], "receipt.pdf", { type: "application/pdf" });
    await userEvent.upload(input, file);
    expect(await screen.findByText(/receipt\.pdf/)).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", async () => {
    const onClose = vi.fn();
    render(<ProductsModal tx={tx} onClose={onClose} />);
    await userEvent.click(await screen.findByTitle("Close"));
    expect(onClose).toHaveBeenCalled();
  });
});
