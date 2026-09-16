// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/transactions",
  useSearchParams: () => new URLSearchParams(search),
}));

import TransactionSearch from "@/components/TransactionSearch";

/** Last URL passed to router.replace. */
function lastUrl(): string {
  return replace.mock.calls.at(-1)![0] as string;
}

beforeEach(() => {
  vi.useFakeTimers();
  replace.mockReset();
  search = "";
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("TransactionSearch", () => {
  it("starts collapsed and expands to an input on click", () => {
    render(<TransactionSearch query="" />);
    expect(screen.queryByRole("searchbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search transactions" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
  });

  it("starts expanded with the current query", () => {
    render(<TransactionSearch query="milk" />);
    expect(screen.getByRole("searchbox")).toHaveValue("milk");
  });

  it("sets q after the debounce, preserving other params", () => {
    search = "months=2026-06&sort=added";
    render(<TransactionSearch query="" />);
    fireEvent.click(screen.getByRole("button", { name: "Search transactions" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "lidl" } });
    expect(replace).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    const params = new URLSearchParams(lastUrl().split("?")[1]);
    expect(params.get("q")).toBe("lidl");
    expect(params.get("months")).toBe("2026-06");
    expect(params.get("sort")).toBe("added");
  });

  it("clear drops q and collapses", () => {
    search = "q=milk";
    render(<TransactionSearch query="milk" />);
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(lastUrl()).toBe("/transactions");
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
