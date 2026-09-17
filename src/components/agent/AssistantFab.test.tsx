// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/plan" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import AssistantFab from "@/components/agent/AssistantFab";

describe("AssistantFab", () => {
  it("sits in the bottom-right FAB slot on pages without a + button", () => {
    nav.pathname = "/plan";
    render(<AssistantFab />);
    const link = screen.getByRole("link", { name: "Assistant" });
    expect(link.getAttribute("href")).toBe("/assistant");
    expect(link.parentElement!.className).toContain("fixed");
  });

  it.each(["/transactions", "/assistant"])("renders nothing on %s", (path) => {
    nav.pathname = path;
    const { container } = render(<AssistantFab />);
    expect(container).toBeEmptyDOMElement();
  });
});
