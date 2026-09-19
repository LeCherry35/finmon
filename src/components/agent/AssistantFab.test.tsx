// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/plan" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("@/actions/suggestions", () => ({ countPendingSuggestions: vi.fn() }));

import AssistantFab from "@/components/agent/AssistantFab";
import { SuggestionCountProvider } from "@/components/agent/SuggestionCount";

describe("AssistantFab", () => {
  it("sits in the bottom-right FAB slot on pages without a + button", () => {
    nav.pathname = "/plan";
    render(<AssistantFab />);
    const link = screen.getByRole("link", { name: "Assistant" });
    expect(link.getAttribute("href")).toBe("/assistant");
    expect(link.parentElement!.className).toContain("fixed");
  });

  it("stacks the pending-suggestions button above it", () => {
    nav.pathname = "/plan";
    render(
      <SuggestionCountProvider enabled={false} initial={2}>
        <AssistantFab />
      </SuggestionCountProvider>,
    );
    const links = screen.getAllByRole("link").map((l) => l.getAttribute("aria-label"));
    expect(links).toEqual(["2 pending suggestions", "Assistant"]);
  });

  it.each(["/transactions", "/assistant"])("renders nothing on %s", (path) => {
    nav.pathname = path;
    const { container } = render(<AssistantFab />);
    expect(container).toBeEmptyDOMElement();
  });
});
