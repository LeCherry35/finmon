// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlanEntry } from "@/db/queries";

const { upsertPlan } = vi.hoisted(() => ({ upsertPlan: vi.fn() }));
vi.mock("@/actions/plans", () => ({ upsertPlan }));

import PlanRow from "@/components/PlanRow";

function renderRow(row: PlanEntry, month = "2026-06") {
  return render(
    <table>
      <tbody>
        <PlanRow row={row} month={month} />
      </tbody>
    </table>,
  );
}

const planned: PlanEntry = {
  category_id: 4,
  category_name: "Food",
  plan_id: 11,
  amount: 500,
  spent: 120,
};

const unplanned: PlanEntry = {
  category_id: 5,
  category_name: "Fun",
  plan_id: null,
  amount: null,
  spent: 0,
};

const unplannedWithSpend: PlanEntry = {
  category_id: 6,
  category_name: "Snacks",
  plan_id: null,
  amount: null,
  spent: 40,
};

// The synthetic "Uncategorized" row (category_id 0) surfaced by getPlansForMonth.
const uncategorized: PlanEntry = {
  category_id: 0,
  category_name: "Uncategorized",
  plan_id: null,
  amount: null,
  spent: 25,
};

beforeEach(() => upsertPlan.mockReset());
afterEach(() => vi.clearAllMocks());

describe("PlanRow", () => {
  it("shows remaining (planned − spent) for a planned row", () => {
    renderRow(planned);
    expect(screen.getByText("380.00")).toBeInTheDocument(); // 500 - 120
    expect(screen.getByText("500.00")).toBeInTheDocument(); // planned amount
  });

  it("treats a missing plan as 0, so left is 0.00 with no spend", () => {
    renderRow(unplanned);
    expect(screen.getByText("0.00")).toBeInTheDocument();
  });

  it("shows spend against an unplanned category as a negative left", () => {
    renderRow(unplannedWithSpend);
    expect(screen.getByText("-40.00")).toBeInTheDocument(); // 0 - 40
  });

  it("renders the Uncategorized row read-only: negative left, no plan input", () => {
    renderRow(uncategorized);
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
    expect(screen.getByText("-25.00")).toBeInTheDocument(); // 0 - 25
    // no amount input and no edit affordance — you can't budget "no category"
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Change planned amount" }),
    ).not.toBeInTheDocument();
  });

  it("shows the amount input immediately for an unplanned row (no Edit needed)", () => {
    renderRow(unplanned);
    expect(screen.getByRole("spinbutton")).toHaveValue(null);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    // no Cancel because there is nothing to revert to
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("upserts the plan with category id, month and amount on save", async () => {
    upsertPlan.mockResolvedValue({ ok: true });
    renderRow(unplanned);
    await userEvent.type(screen.getByRole("spinbutton"), "250");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(upsertPlan).toHaveBeenCalledTimes(1));
    const fd = upsertPlan.mock.calls[0][0] as FormData;
    expect(fd.get("category_id")).toBe("5");
    expect(fd.get("month")).toBe("2026-06");
    expect(fd.get("amount")).toBe("250");
  });

  it("keeps Save disabled until an amount is entered", async () => {
    renderRow(unplanned);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    await userEvent.type(screen.getByRole("spinbutton"), "10");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("allows saving an explicit 0 plan", async () => {
    upsertPlan.mockResolvedValue({ ok: true });
    renderRow(unplanned);
    await userEvent.type(screen.getByRole("spinbutton"), "0");
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    await waitFor(() => expect(upsertPlan).toHaveBeenCalledTimes(1));
    expect((upsertPlan.mock.calls[0][0] as FormData).get("amount")).toBe("0");
  });

  it("lets a planned row switch to editing and revert via Cancel", async () => {
    renderRow(planned);
    await userEvent.click(
      screen.getByRole("button", { name: "Change planned amount" }),
    );
    const input = screen.getByRole("spinbutton");
    expect(input).toHaveValue(500);
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(upsertPlan).not.toHaveBeenCalled();
    expect(screen.getByText("500.00")).toBeInTheDocument();
  });

  it("surfaces the server error on a failed upsert", async () => {
    upsertPlan.mockResolvedValue({ ok: false, error: "Invalid amount" });
    renderRow(unplanned);
    await userEvent.type(screen.getByRole("spinbutton"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Invalid amount")).toBeInTheDocument();
  });
});
