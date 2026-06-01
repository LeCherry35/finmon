// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category } from "@/actions/categories";

// useActionState calls createTransaction(prevState, formData); the mock controls
// the returned state so we can drive the success/error branches.
const { createTransaction } = vi.hoisted(() => ({ createTransaction: vi.fn() }));
vi.mock("@/actions/transactions", () => ({ createTransaction }));

import TransactionCreateSheet from "@/components/TransactionCreateSheet";

const categories: Category[] = [
  { id: 1, name: "Food", priority: 5 },
  { id: 2, name: "Rent", priority: 9 },
];

function renderSheet() {
  return render(
    <TransactionCreateSheet categories={categories} today="2026-06-01" />,
  );
}

function openSheet() {
  // While closed, the FAB is the only "Add transaction" button.
  return userEvent.click(screen.getByRole("button", { name: "Add transaction" }));
}

/** The submit button, scoped to the dialog (the FAB shares its name). */
function submitBtn() {
  return within(screen.getByRole("dialog")).getByRole("button", {
    name: "Add transaction",
  });
}

beforeEach(() => {
  createTransaction.mockReset();
  // default: a successful submit bumps successCount
  createTransaction.mockResolvedValue({ successCount: 1 });
});
afterEach(() => vi.clearAllMocks());

describe("TransactionCreateSheet", () => {
  it("is closed until the FAB is tapped", () => {
    renderSheet();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the bottom sheet on FAB tap", async () => {
    renderSheet();
    await openSheet();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(submitBtn()).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    renderSheet();
    await openSheet();
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("closes when the Close button is pressed", async () => {
    renderSheet();
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("submits the entered fields and auto-closes on success", async () => {
    renderSheet();
    await openSheet();

    await userEvent.type(screen.getByPlaceholderText("0.00"), "15");
    await userEvent.type(screen.getByPlaceholderText("Category"), "Food");
    await userEvent.click(submitBtn());

    await waitFor(() => expect(createTransaction).toHaveBeenCalledTimes(1));
    const fd = createTransaction.mock.calls[0][1] as FormData;
    expect(fd.get("amount")).toBe("15");
    expect(fd.get("category_name")).toBe("Food");
    expect(fd.get("date")).toBe("2026-06-01");

    // successCount went 0 → 1, so the sheet closes itself
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("shows the action error and stays open on failure", async () => {
    createTransaction.mockResolvedValue({
      successCount: 0,
      error: "Amount must be positive",
    });
    renderSheet();
    await openSheet();
    // Use a value that passes the input's own min constraint so the form
    // actually submits — the mocked action decides the error, not the input.
    await userEvent.type(screen.getByPlaceholderText("0.00"), "15");
    await userEvent.type(screen.getByPlaceholderText("Category"), "Food");
    await userEvent.click(submitBtn());

    expect(
      await screen.findByText("Amount must be positive"),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("lists known categories as datalist options", async () => {
    renderSheet();
    await openSheet();
    const options = screen
      .getByRole("dialog")
      .querySelectorAll("datalist option");
    expect([...options].map((o) => o.getAttribute("value"))).toEqual([
      "Food",
      "Rent",
    ]);
  });
});
