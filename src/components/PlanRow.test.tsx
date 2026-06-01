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

beforeEach(() => upsertPlan.mockReset());
afterEach(() => vi.clearAllMocks());

describe("PlanRow", () => {
  it("shows remaining (planned − spent) for a planned row", () => {
    renderRow(planned);
    expect(screen.getByText("380.00")).toBeInTheDocument(); // 500 - 120
    expect(screen.getByText("500.00")).toBeInTheDocument(); // planned amount
  });

  it("renders an em dash for left when the category has no plan", () => {
    renderRow(unplanned);
    expect(screen.getByText("—")).toBeInTheDocument();
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
