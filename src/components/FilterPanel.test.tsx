// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Category } from "@/actions/categories";
import type { Filters } from "@/lib/filters";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(search),
}));

import FilterPanel from "@/components/FilterPanel";

const categories: Category[] = [
  { id: 1, name: "Food", priority: 5 },
  { id: 2, name: "Rent", priority: 9 },
];
const availableMonths = ["2026-06", "2026-05", "2026-04"];

function renderPanel(selected: Filters) {
  return render(
    <FilterPanel
      availableMonths={availableMonths}
      categories={categories}
      selected={selected}
    />,
  );
}

/** Open the dropdown by clicking the trigger. */
async function open() {
  await userEvent.click(
    screen.getByRole("button", { expanded: false }),
  );
}

/** Last URL passed to router.replace, as URLSearchParams. */
function lastParams(): URLSearchParams {
  const [url] = replace.mock.calls.at(-1)!;
  return new URLSearchParams(url.includes("?") ? url.split("?")[1] : "");
}

beforeEach(() => {
  replace.mockReset();
  search = "";
  localStorage.clear();
});
afterEach(() => vi.clearAllMocks());

describe("FilterPanel", () => {
  it("summarizes the default selection on the closed trigger", () => {
    renderPanel({ months: ["2026-06"], categoryIds: "all" });
    // panel is collapsed initially
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument();
    expect(screen.queryByText("Months")).not.toBeInTheDocument();
  });

  it("opens the dropdown and lists months and categories", async () => {
    renderPanel({ months: ["2026-06"], categoryIds: "all" });
    await open();
    expect(screen.getByText("Months")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Rent")).toBeInTheDocument();
  });

  it("adds a month to the URL when an unchecked month is toggled on", async () => {
    renderPanel({ months: ["2026-06"], categoryIds: "all" });
    await open();
    const monthsSection = screen.getByText("Months").closest("section")!;
    await userEvent.click(within(monthsSection).getByLabelText("May 2026"));

    const p = lastParams();
    const months = p.get("months")!.split(",");
    expect(months).toContain("2026-06");
    expect(months).toContain("2026-05");
    // categories left at default → param omitted
    expect(p.has("categories")).toBe(false);
  });

  it("removes a month from the URL when a checked month is toggled off", async () => {
    renderPanel({ months: ["2026-06", "2026-05"], categoryIds: "all" });
    await open();
    const monthsSection = screen.getByText("Months").closest("section")!;
    await userEvent.click(within(monthsSection).getByLabelText("Jun 2026"));
    expect(lastParams().get("months")).toBe("2026-05");
  });

  it("collapses 'all but one' category selection back to the categories param", async () => {
    // start with all categories selected; unchecking one should list the rest
    renderPanel({ months: ["2026-06"], categoryIds: "all" });
    await open();
    const catSection = screen.getByText("Categories").closest("section")!;
    await userEvent.click(within(catSection).getByLabelText("Food"));
    expect(lastParams().get("categories")).toBe("2"); // only Rent remains
  });

  it("drops the categories param when the last toggle re-selects everything", async () => {
    renderPanel({ months: ["2026-06"], categoryIds: [2] });
    await open();
    const catSection = screen.getByText("Categories").closest("section")!;
    // selecting Food makes it {1,2} === all categories → param removed
    await userEvent.click(within(catSection).getByLabelText("Food"));
    expect(lastParams().has("categories")).toBe(false);
  });

  it("clears both params via 'Clear all'", async () => {
    search = "months=2026-05&categories=1";
    renderPanel({ months: ["2026-05"], categoryIds: [1] });
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Clear all" }));
    const p = lastParams();
    expect(p.has("months")).toBe(false);
    expect(p.has("categories")).toBe(false);
  });

  it("hides the categories section when showCategoryFilter is false", async () => {
    render(
      <FilterPanel
        availableMonths={availableMonths}
        categories={categories}
        selected={{ months: ["2026-06"], categoryIds: "all" }}
        showCategoryFilter={false}
      />,
    );
    await open();
    expect(screen.getByText("Months")).toBeInTheDocument();
    expect(screen.queryByText("Categories")).not.toBeInTheDocument();
  });
});
