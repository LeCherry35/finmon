// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/transactions" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

import AssistantFab from "@/components/agent/AssistantFab";

describe("AssistantFab", () => {
  it("stacks above the + button on /transactions", () => {
    nav.pathname = "/transactions";
    render(<AssistantFab />);
    const link = screen.getByRole("link", { name: "Assistant" });
    expect(link.getAttribute("href")).toBe("/assistant");
    expect(link.className).toContain("+9.5rem");
    expect(link.className).toContain("md:hidden");
  });

  it("takes the + slot on other pages", () => {
    nav.pathname = "/plan";
    render(<AssistantFab />);
    expect(screen.getByRole("link", { name: "Assistant" }).className).toContain("+5rem)]");
  });

  it("is hidden on the assistant page itself", () => {
    nav.pathname = "/assistant";
    const { container } = render(<AssistantFab />);
    expect(container).toBeEmptyDOMElement();
  });
});
