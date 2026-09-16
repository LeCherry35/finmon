// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({
  pathname: "/expenditures",
  search: "months=2026-07,2026-08&categories=3&sort=added",
}));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import NavLinks from "@/components/NavLinks";
import MobileBottomNav from "@/components/MobileBottomNav";

afterEach(() => sessionStorage.clear());

function hrefOf(name: string) {
  return screen.getAllByRole("link", { name })[0].getAttribute("href");
}

describe("nav filter memory", () => {
  it("carries the current filters to filter pages but not to /categories", async () => {
    render(
      <>
        <NavLinks />
        <MobileBottomNav />
      </>,
    );
    const q = "?months=2026-07,2026-08&categories=3";
    await waitFor(() => expect(hrefOf("Plan")).toBe(`/plan${q}`));
    expect(hrefOf("Transactions")).toBe(`/transactions${q}`);
    expect(hrefOf("Charts")).toBe(`/charts${q}`);
    expect(hrefOf("Categories")).toBe("/categories");
    // both navs share the memory
    for (const link of screen.getAllByRole("link", { name: "Expenditures" }))
      expect(link.getAttribute("href")).toBe(`/expenditures${q}`);
  });

  it("does not record while on a non-filter page", async () => {
    sessionStorage.setItem("finmon:filter-query", "?categories=9");
    nav.pathname = "/categories";
    nav.search = "";
    render(<NavLinks />);
    await waitFor(() => expect(hrefOf("Plan")).toBe("/plan?categories=9"));
  });
});
