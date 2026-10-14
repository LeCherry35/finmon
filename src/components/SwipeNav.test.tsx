// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/categories", push: vi.fn(), prefetch: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, prefetch: nav.prefetch }),
}));

import SwipeNav, { shouldCommit, swipeTarget } from "@/components/SwipeNav";

describe("swipeTarget", () => {
  it("steps through the bottom-nav order", () => {
    expect(swipeTarget("/categories", 1)).toBe("/expenditures");
    expect(swipeTarget("/categories", -1)).toBe("/transactions");
  });

  it("stops at either end", () => {
    expect(swipeTarget("/transactions", -1)).toBeNull();
    expect(swipeTarget("/charts", 1)).toBeNull();
  });

  it("is inert off the tabs", () => {
    expect(swipeTarget("/assistant", 1)).toBeNull();
  });

  it("carries the filter query to filter pages only", () => {
    expect(swipeTarget("/categories", 1, "?months=2026-08")).toBe("/expenditures?months=2026-08");
    expect(swipeTarget("/expenditures", -1, "?months=2026-08")).toBe("/categories");
  });
});

describe("shouldCommit", () => {
  it.each([
    [100, 0, 375, true], // past a quarter
    [80, 0, 375, false],
    [50, 0.8, 375, true], // flick
    [30, 2, 375, false], // flick too short
  ])("dx=%d v=%d w=%d → %s", (dx, v, w, out) => {
    expect(shouldCommit(dx, v, w)).toBe(out);
  });
});

describe("SwipeNav gesture", () => {
  beforeEach(() => {
    nav.pathname = "/categories";
    window.innerWidth = 375;
    window.matchMedia = vi.fn((q: string) => ({ matches: q.includes("max-width") })) as never;
  });
  afterEach(() => vi.clearAllMocks());

  function swipe(el: Element, dx: number, dy = 0) {
    fireEvent.touchStart(el, { touches: [{ clientX: 200, clientY: 300 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx / 2, clientY: 300 + dy / 2 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 200 + dx, clientY: 300 + dy }] });
  }

  function setup() {
    render(
      <SwipeNav>
        <p>page</p>
        <input aria-label="field" />
        <div data-no-swipe>chart</div>
      </SwipeNav>,
    );
  }

  it("navigates to the next tab on a long left swipe", () => {
    setup();
    swipe(screen.getByText("page"), -150);
    expect(nav.push).toHaveBeenCalledWith("/expenditures");
  });

  it("navigates to the previous tab on a long right swipe", () => {
    setup();
    swipe(screen.getByText("page"), 150);
    expect(nav.push).toHaveBeenCalledWith("/transactions");
  });

  it.each([
    ["a vertical drag", "page", -60, 200],
    ["a short swipe (slow)", "page", -20, 0],
    ["a swipe on an input", "field", -150, 0],
    ["a swipe in [data-no-swipe]", "chart", -150, 0],
  ])("ignores %s", (_, target, dx, dy) => {
    setup();
    const el = target === "field" ? screen.getByLabelText("field") : screen.getByText(target);
    swipe(el, dx, dy);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("does nothing on desktop", () => {
    window.matchMedia = vi.fn(() => ({ matches: false })) as never;
    setup();
    swipe(screen.getByText("page"), -150);
    expect(nav.push).not.toHaveBeenCalled();
  });
});
