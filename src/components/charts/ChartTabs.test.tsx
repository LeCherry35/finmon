// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/charts",
  useSearchParams: () => new URLSearchParams(search),
}));

import ChartTabs from "@/components/charts/ChartTabs";

beforeEach(() => {
  replace.mockReset();
  search = "";
});
afterEach(() => vi.clearAllMocks());

describe("ChartTabs", () => {
  it("renders a tab per registered chart with the active one selected", () => {
    render(<ChartTabs current="expenditures-over-time" />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(
      screen.getByRole("tab", { name: "Expenditures over time" }),
    ).toHaveAttribute("aria-selected", "true");
  });

  it("sets the chart param when selecting a non-default chart", async () => {
    render(<ChartTabs current="expenditures-over-time" />);
    await userEvent.click(screen.getByRole("tab", { name: "Category share" }));
    expect(replace).toHaveBeenCalledWith("/charts?chart=category-share", {
      scroll: false,
    });
  });

  it("removes the chart param when selecting the default chart", async () => {
    search = "chart=category-share";
    render(<ChartTabs current="category-share" />);
    await userEvent.click(
      screen.getByRole("tab", { name: "Expenditures over time" }),
    );
    expect(replace).toHaveBeenCalledWith("/charts", { scroll: false });
  });

  it("preserves unrelated query params when switching", async () => {
    search = "months=2026-06";
    render(<ChartTabs current="expenditures-over-time" />);
    await userEvent.click(screen.getByRole("tab", { name: "Category share" }));
    const [url] = replace.mock.calls[0];
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("months")).toBe("2026-06");
    expect(qs.get("chart")).toBe("category-share");
  });

  it("is a no-op when the active tab is clicked again", async () => {
    render(<ChartTabs current="category-share" />);
    await userEvent.click(screen.getByRole("tab", { name: "Category share" }));
    expect(replace).not.toHaveBeenCalled();
  });
});
