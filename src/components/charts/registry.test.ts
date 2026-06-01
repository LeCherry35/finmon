import { describe, expect, it } from "vitest";
import { CHARTS, DEFAULT_CHART, type ChartId } from "@/components/charts/registry";
import { NAV_LINKS } from "@/lib/nav";

describe("charts registry", () => {
  it("every registered chart has a non-empty id and label", () => {
    for (const c of CHARTS) {
      expect(c.id).toBeTruthy();
      expect(c.label).toBeTruthy();
    }
  });

  it("has no duplicate chart ids", () => {
    const ids = CHARTS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("DEFAULT_CHART is one of the registered charts", () => {
    const ids = CHARTS.map((c) => c.id);
    expect(ids).toContain(DEFAULT_CHART satisfies ChartId);
  });
});

describe("nav links", () => {
  it("have unique, absolute hrefs and labels", () => {
    const hrefs = NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const l of NAV_LINKS) {
      expect(l.href.startsWith("/")).toBe(true);
      expect(l.label).toBeTruthy();
      expect(l.short).toBeTruthy();
    }
  });
});
