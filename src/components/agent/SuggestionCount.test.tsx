// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/plan" }));
const { countPendingSuggestions } = vi.hoisted(() => ({ countPendingSuggestions: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/actions/suggestions", () => ({ countPendingSuggestions }));

import { SuggestionCountProvider, SuggestionsButton as Buttons } from "@/components/agent/SuggestionCount";

beforeEach(() => {
  nav.pathname = "/plan";
  countPendingSuggestions.mockReset().mockResolvedValue(3);
});

describe("suggestion count buttons", () => {
  it("shows the pending count and links to /suggestions (mobile only)", () => {
    render(
      <SuggestionCountProvider enabled={false} initial={3}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    const link = screen.getByRole("link", { name: "3 pending suggestions" });
    expect(link.textContent).toBe("3");
    expect(link.getAttribute("href")).toBe("/suggestions");
    expect(link.className).toContain("md:hidden");
  });

  it("render nothing with nothing pending", () => {
    const { container } = render(
      <SuggestionCountProvider enabled={false} initial={0}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("hide on the Suggestions page itself", () => {
    nav.pathname = "/suggestions";
    const { container } = render(
      <SuggestionCountProvider enabled={false} initial={3}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("refetches the count on page change and window focus", async () => {
    const { rerender } = render(
      <SuggestionCountProvider enabled initial={0}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole("link", { name: "3 pending suggestions" })).toHaveLength(1));
    expect(countPendingSuggestions).toHaveBeenCalledTimes(1);

    nav.pathname = "/charts";
    rerender(
      <SuggestionCountProvider enabled initial={0}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    await waitFor(() => expect(countPendingSuggestions).toHaveBeenCalledTimes(2));

    countPendingSuggestions.mockResolvedValue(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() => expect(screen.getAllByRole("link", { name: "1 pending suggestion" })).toHaveLength(1));
  });

  it("fetches nothing when disabled (signed out / assistant off)", () => {
    render(
      <SuggestionCountProvider enabled={false} initial={0}>
        <Buttons />
      </SuggestionCountProvider>,
    );
    window.dispatchEvent(new Event("focus"));
    expect(countPendingSuggestions).not.toHaveBeenCalled();
  });
});
