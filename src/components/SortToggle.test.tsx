// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(search),
}));

import SortToggle from "@/components/SortToggle";

/** Last URL passed to router.replace. */
function lastUrl(): string {
  return replace.mock.calls.at(-1)![0] as string;
}

beforeEach(() => {
  replace.mockReset();
  search = "";
});
afterEach(() => vi.clearAllMocks());

describe("SortToggle", () => {
  it("shows the current sort label", () => {
    render(<SortToggle sort="date" />);
    expect(screen.getByText("Transaction date")).toBeInTheDocument();
  });

  it("switches to 'added' by setting the sort param", async () => {
    render(<SortToggle sort="date" />);
    await userEvent.click(screen.getByRole("button"));
    expect(lastUrl()).toBe("/transactions?sort=added");
  });

  it("switches back to the default by dropping the sort param", async () => {
    search = "sort=added";
    render(<SortToggle sort="added" />);
    await userEvent.click(screen.getByRole("button"));
    // default sort → clean URL, no leftover param
    expect(lastUrl()).toBe("/transactions");
  });

  it("preserves existing filter params when toggling", async () => {
    search = "months=2026-06&categories=1";
    render(<SortToggle sort="date" />);
    await userEvent.click(screen.getByRole("button"));
    const params = new URLSearchParams(lastUrl().split("?")[1]);
    expect(params.get("sort")).toBe("added");
    expect(params.get("months")).toBe("2026-06");
    expect(params.get("categories")).toBe("1");
  });
});
