// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import AssistantMarkdown from "@/components/agent/AssistantMarkdown";

describe("AssistantMarkdown", () => {
  it("renders a GFM table", () => {
    const text = "| Category | Spent |\n|---|---|\n| Clothes | 28 420 |\n| Sport | **7 605** |";
    const { container } = render(<AssistantMarkdown text={text} />);
    expect(container.querySelector("table")).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Category" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Clothes" })).toBeInTheDocument();
    expect(screen.getByText("7 605").tagName).toBe("STRONG");
  });

  it("renders lists and bold", () => {
    render(<AssistantMarkdown text={"- **one**\n- two"} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("one").tagName).toBe("STRONG");
  });

  it("does not render raw HTML", () => {
    const { container } = render(<AssistantMarkdown text={'hi <script>alert(1)</script><img src="x">'} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});
