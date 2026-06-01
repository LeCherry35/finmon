// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";

const { updateTransaction, deleteTransaction } = vi.hoisted(() => ({
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
}));
vi.mock("@/actions/transactions", () => ({
  updateTransaction,
  deleteTransaction,
}));

import TransactionRow from "@/components/TransactionRow";

const categories: Category[] = [
  { id: 1, name: "Food", priority: 5 },
  { id: 2, name: "Rent", priority: 9 },
];

const tx: Transaction = {
  id: 42,
  amount: 12.5,
  type: "spend",
  category_id: 1,
  date: "2026-06-01",
  note: "lunch",
  category_name: "Food",
};

/** The desktop `<tr>` (the one that is `hidden md:table-row`). */
function desktopRow(): HTMLElement {
  // The date cell text only appears in the desktop row.
  return screen.getByText("2026-06-01").closest("tr") as HTMLElement;
}

beforeEach(() => {
  updateTransaction.mockReset();
  deleteTransaction.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("TransactionRow", () => {
  it("renders amount with a sign and category in the desktop row", () => {
    render(
      <table>
        <tbody>
          <TransactionRow tx={tx} categories={categories} />
        </tbody>
      </table>,
    );
    const row = desktopRow();
    expect(within(row).getByText("-12.50")).toBeInTheDocument();
    expect(within(row).getByText("Food")).toBeInTheDocument();
  });

  it("requires a second click to confirm a delete", async () => {
    deleteTransaction.mockResolvedValue(undefined);
    render(
      <table>
        <tbody>
          <TransactionRow tx={tx} categories={categories} />
        </tbody>
      </table>,
    );
    const del = within(desktopRow()).getByTitle("Delete");

    await userEvent.click(del);
    expect(deleteTransaction).not.toHaveBeenCalled();
    // title flips to the confirm hint
    expect(
      within(desktopRow()).getByTitle("Click again to confirm"),
    ).toBeInTheDocument();

    await userEvent.click(
      within(desktopRow()).getByTitle("Click again to confirm"),
    );
    await waitFor(() => expect(deleteTransaction).toHaveBeenCalledTimes(1));
    const fd = deleteTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("42");
  });

  it("edits a transaction and submits the changed fields", async () => {
    updateTransaction.mockResolvedValue({ ok: true });
    render(
      <table>
        <tbody>
          <TransactionRow tx={tx} categories={categories} />
        </tbody>
      </table>,
    );
    await userEvent.click(within(desktopRow()).getByTitle("Edit"));

    // Save has a title only on the desktop row (mobile uses a text button),
    // so it uniquely identifies the desktop editing <tr>.
    const row = screen.getByTitle("Save").closest("tr") as HTMLElement;
    const amount = within(row).getByDisplayValue("12.5");
    await userEvent.clear(amount);
    await userEvent.type(amount, "20");
    await userEvent.click(within(row).getByTitle("Save"));

    await waitFor(() => expect(updateTransaction).toHaveBeenCalledTimes(1));
    const fd = updateTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("42");
    expect(fd.get("amount")).toBe("20");
    expect(fd.get("category_id")).toBe("1");
  });

  it("shows the server error and stays editing on a failed update", async () => {
    updateTransaction.mockResolvedValue({ ok: false, error: "Invalid category" });
    render(
      <table>
        <tbody>
          <TransactionRow tx={tx} categories={categories} />
        </tbody>
      </table>,
    );
    await userEvent.click(within(desktopRow()).getByTitle("Edit"));
    const row = screen.getByTitle("Save").closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByTitle("Save"));

    // The error renders in both the mobile card and the desktop row.
    expect((await screen.findAllByText("Invalid category")).length).toBeGreaterThan(
      0,
    );
    expect(updateTransaction).toHaveBeenCalledTimes(1);
  });
});
