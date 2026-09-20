// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { updateCategory, setDefaultCategory, deleteCategory } = vi.hoisted(() => ({
  updateCategory: vi.fn(),
  setDefaultCategory: vi.fn(),
  deleteCategory: vi.fn(),
}));
vi.mock("@/actions/categories", () => ({ updateCategory, setDefaultCategory, deleteCategory }));

import CategoryRow from "@/components/CategoryRow";

function renderRow(
  category = { id: 3, name: "Food", priority: 7, is_default: false },
  usage: { transactions?: number; plans?: number } = {},
) {
  return render(
    <table>
      <tbody>
        <CategoryRow category={category} defaultName="other" {...usage} />
      </tbody>
    </table>,
  );
}

beforeEach(() => {
  updateCategory.mockReset();
  setDefaultCategory.mockReset();
  deleteCategory.mockReset();
});
afterEach(() => vi.clearAllMocks());

describe("CategoryRow", () => {
  it("shows the name and priority as static text until edited", () => {
    renderRow();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reveals editable inputs when Edit is clicked", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("Food");
    expect(screen.getByRole("spinbutton")).toHaveValue(7);
  });

  it("saves the edited values with the category id and closes on success", async () => {
    updateCategory.mockResolvedValue({ ok: true });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const name = screen.getByRole("textbox");
    await userEvent.clear(name);
    await userEvent.type(name, "Groceries");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateCategory).toHaveBeenCalledTimes(1));
    const fd = updateCategory.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("3");
    expect(fd.get("name")).toBe("Groceries");
    expect(fd.get("priority")).toBe("7");

    // edit mode closed → static text again
    await waitFor(() =>
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Groceries")).toBeInTheDocument();
  });

  it("shows the server error and stays in edit mode on failure", async () => {
    updateCategory.mockResolvedValue({ ok: false, error: "Name already used" });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Name already used")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument(); // still editing
  });

  it("discards edits on cancel", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    const name = screen.getByRole("textbox");
    await userEvent.clear(name);
    await userEvent.type(name, "Discarded");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateCategory).not.toHaveBeenCalled();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
  });

  it("re-opening edit after cancel shows the original value", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    await userEvent.clear(screen.getByRole("textbox"));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox")).toHaveValue("Food");
  });

  it("marks the default category and hides its destructive controls", () => {
    renderRow({ id: 3, name: "other", priority: 5, is_default: true });
    expect(screen.getByText("Default")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make default" })).not.toBeInTheDocument();
  });

  it("promotes the row to default with its id", async () => {
    setDefaultCategory.mockResolvedValue({ ok: true });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Make default" }));

    await waitFor(() => expect(setDefaultCategory).toHaveBeenCalledTimes(1));
    const fd = setDefaultCategory.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("3");
  });

  it("surfaces a failed promotion", async () => {
    setDefaultCategory.mockResolvedValue({ ok: false, error: "Invalid category" });
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Make default" }));
    expect(await screen.findByText("Invalid category")).toBeInTheDocument();
  });

  it("confirms a delete with the impact counts before calling the action", async () => {
    deleteCategory.mockResolvedValue({ ok: true });
    renderRow(undefined, { transactions: 4, plans: 2 });

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/4 transactions will move to/)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 monthly plans will be deleted/)).toBeInTheDocument();
    expect(deleteCategory).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteCategory).toHaveBeenCalledTimes(1));
    expect((deleteCategory.mock.calls[0][0] as FormData).get("id")).toBe("3");
  });

  it("cancels the delete dialog without deleting", async () => {
    renderRow();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(deleteCategory).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps within() scoping intact for a second independent row", async () => {
    render(
      <table>
        <tbody>
          <CategoryRow
            category={{ id: 1, name: "Rent", priority: 10, is_default: false }}
            defaultName="other"
          />
          <CategoryRow
            category={{ id: 2, name: "Fun", priority: 2, is_default: false }}
            defaultName="other"
          />
        </tbody>
      </table>,
    );
    // two Edit buttons, one per row
    const edits = screen.getAllByRole("button", { name: "Edit" });
    expect(edits).toHaveLength(2);
    const rentRow = screen.getByText("Rent").closest("tr")!;
    expect(within(rentRow).getByText("10")).toBeInTheDocument();
  });
});
