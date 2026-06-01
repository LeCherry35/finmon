import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildFilterQuery,
  currentMonth,
  formatMonthLabel,
  parseFilters,
  resolveFilters,
  summarizeFilters,
  type Filters,
} from "@/lib/filters";

describe("parseFilters", () => {
  it("treats missing params as the defaults", () => {
    expect(parseFilters({})).toEqual({ months: "default", categoryIds: "all" });
  });

  it("treats an empty string as an explicit deselect-all", () => {
    expect(parseFilters({ months: "", categories: "" })).toEqual({
      months: [],
      categoryIds: [],
    });
  });

  it("splits comma lists and trims whitespace", () => {
    expect(parseFilters({ months: " 2026-06 , 2026-07 " }).months).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("drops months that fail YYYY-MM validation", () => {
    expect(parseFilters({ months: "2026-06,nope,2026/07" }).months).toEqual([
      "2026-06",
    ]);
  });

  it("joins array-valued params before splitting", () => {
    expect(parseFilters({ months: ["2026-06", "2026-07"] }).months).toEqual([
      "2026-06",
      "2026-07",
    ]);
  });

  it("keeps only positive integer category ids", () => {
    expect(
      parseFilters({ categories: "1,2,0,-3,1.5,abc" }).categoryIds,
    ).toEqual([1, 2]);
  });
});

describe("resolveFilters", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves default months to the current month", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
    expect(resolveFilters({ months: "default", categoryIds: "all" })).toEqual({
      months: ["2026-03"],
      categoryIds: null,
    });
  });

  it("resolves 'all' categories to null and passes months through", () => {
    expect(
      resolveFilters({ months: ["2026-01"], categoryIds: "all" }),
    ).toEqual({ months: ["2026-01"], categoryIds: null });
  });

  it("passes explicit category ids through unchanged", () => {
    expect(
      resolveFilters({ months: ["2026-01"], categoryIds: [3, 4] }),
    ).toEqual({ months: ["2026-01"], categoryIds: [3, 4] });
  });
});

describe("buildFilterQuery", () => {
  it("returns an empty string when both are at their defaults", () => {
    expect(buildFilterQuery("default", "all")).toBe("");
  });

  it("emits only the non-default params", () => {
    expect(buildFilterQuery(["2026-06"], "all")).toBe("?months=2026-06");
    expect(buildFilterQuery("default", [1, 2])).toBe("?categories=1,2");
  });

  it("emits both params joined by &", () => {
    expect(buildFilterQuery(["2026-06", "2026-07"], [1, 2])).toBe(
      "?months=2026-06,2026-07&categories=1,2",
    );
  });

  it("round-trips through parseFilters", () => {
    const f: Filters = { months: ["2026-06"], categoryIds: [1, 2] };
    const qs = buildFilterQuery(f.months, f.categoryIds);
    const sp = Object.fromEntries(new URLSearchParams(qs.replace(/^\?/, "")));
    expect(parseFilters(sp)).toEqual(f);
  });
});

describe("formatMonthLabel", () => {
  it("formats a valid month", () => {
    expect(formatMonthLabel("2026-06")).toBe("Jun 2026");
  });

  it("returns malformed input unchanged", () => {
    expect(formatMonthLabel("nope")).toBe("nope");
  });
});

describe("summarizeFilters", () => {
  it("summarizes month selections", () => {
    expect(summarizeFilters({ months: [], categoryIds: "all" }, 5)).toContain(
      "No months",
    );
    expect(
      summarizeFilters({ months: ["2026-06"], categoryIds: "all" }, 5),
    ).toContain("Jun 2026");
    expect(
      summarizeFilters(
        { months: ["2026-06", "2026-07"], categoryIds: "all" },
        5,
      ),
    ).toContain("2 months");
  });

  it("summarizes category selections, collapsing full selection to 'All'", () => {
    expect(
      summarizeFilters({ months: ["2026-06"], categoryIds: "all" }, 5),
    ).toContain("All");
    expect(
      summarizeFilters({ months: ["2026-06"], categoryIds: [] }, 5),
    ).toContain("No categories");
    expect(
      summarizeFilters({ months: ["2026-06"], categoryIds: [1, 2, 3, 4, 5] }, 5),
    ).toContain("All");
    expect(
      summarizeFilters({ months: ["2026-06"], categoryIds: [1, 2] }, 5),
    ).toContain("2 categories");
  });
});

describe("currentMonth", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the UTC year-month of now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T08:30:00Z"));
    expect(currentMonth()).toBe("2026-11");
  });
});
