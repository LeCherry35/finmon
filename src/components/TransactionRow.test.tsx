// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Transaction } from "@/actions/transactions";
import type { Category } from "@/actions/categories";

const { updateTransaction, deleteTransaction, verifyTransaction } = vi.hoisted(() => ({
  updateTransaction: vi.fn(),
  deleteTransaction: vi.fn(),
  verifyTransaction: vi.fn(),
}));
vi.mock("@/actions/transactions", () => ({
  updateTransaction,
  deleteTransaction,
  verifyTransaction,
}));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

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
  store: "Tesco",
  status: "unverified",
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
  verifyTransaction.mockReset();
  refresh.mockReset();
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

  it("no longer has inline Edit or Verify buttons on the row", () => {
    render(
      <table>
        <tbody>
          <TransactionRow
            tx={{ ...tx, status: "ready_to_verify" }}
            categories={categories}
          />
        </tbody>
      </table>,
    );
    expect(within(desktopRow()).queryByTitle("Edit")).not.toBeInTheDocument();
    expect(within(desktopRow()).queryByTitle("Verify")).not.toBeInTheDocument();
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

  it("does not verify when the status is not ready_to_verify", async () => {
    render(
      <table>
        <tbody>
          <TransactionRow tx={tx} categories={categories} />
        </tbody>
      </table>,
    );
    // The 'unverified' badge is plain text, not a verify button.
    expect(
      within(desktopRow()).queryByRole("button", { name: "Unverified" }),
    ).not.toBeInTheDocument();
    expect(verifyTransaction).not.toHaveBeenCalled();
  });

  it("polls router.refresh while the row is processing (self-heal)", () => {
    vi.useFakeTimers();
    try {
      render(
        <table>
          <tbody>
            <TransactionRow
              tx={{ ...tx, status: "processing" }}
              categories={categories}
            />
          </tbody>
        </table>,
      );
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(4000);
      expect(refresh).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(4000);
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not poll when the row is not processing", () => {
    vi.useFakeTimers();
    try {
      render(
        <table>
          <tbody>
            <TransactionRow tx={tx} categories={categories} />
          </tbody>
        </table>,
      );
      vi.advanceTimersByTime(12000);
      expect(refresh).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("verifies a ready_to_verify transaction by clicking its status tag", async () => {
    verifyTransaction.mockResolvedValue({ ok: true });
    render(
      <table>
        <tbody>
          <TransactionRow
            tx={{ ...tx, status: "ready_to_verify" }}
            categories={categories}
          />
        </tbody>
      </table>,
    );
    await userEvent.click(
      within(desktopRow()).getByRole("button", { name: "Ready to verify" }),
    );

    await waitFor(() => expect(verifyTransaction).toHaveBeenCalledTimes(1));
    const fd = verifyTransaction.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("42");
  });
});
