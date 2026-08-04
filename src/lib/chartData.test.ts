import { describe, expect, it } from "vitest";
import { monthTransitionBuckets, pivotForRecharts, seriesKey } from "@/lib/chartData";
import type { Category } from "@/actions/categories";
import type { ExpenditureSeriesRow } from "@/db/queries";

const categories: Category[] = [
  { id: 1, name: "Food", priority: 0 },
  { id: 2, name: "Rent", priority: 0 },
];

function row(
  category_id: number,
  bucket: string,
  total: number | string,
): ExpenditureSeriesRow {
  return {
    category_id,
    category_name: "x",
    priority: 0,
    bucket,
    total: total as number,
  };
}

describe("pivotForRecharts", () => {
  // Series are keyed by category id (seriesKey), not name — see the collision
  // case at the bottom of this block.
  it("produces one wide point per bucket, zero-filling missing categories", () => {
    const points = pivotForRecharts(
      ["2026-06-01", "2026-06-02"],
      categories,
      [row(1, "2026-06-01", 10)],
    );
    expect(points).toEqual([
      { bucket: "2026-06-01", "1": 10, "2": 0 },
      { bucket: "2026-06-02", "1": 0, "2": 0 },
    ]);
  });

  it("coerces string totals (as pg returns them) to numbers", () => {
    const [point] = pivotForRecharts(
      ["2026-06-01"],
      categories,
      [row(1, "2026-06-01", "12.50")],
    );
    expect(point[seriesKey(1)]).toBe(12.5);
  });

  it("ignores rows for categories not in the list", () => {
    const [point] = pivotForRecharts(
      ["2026-06-01"],
      categories,
      [row(99, "2026-06-01", 10)],
    );
    expect(point).toEqual({ bucket: "2026-06-01", "1": 0, "2": 0 });
  });

  it("keeps same-named categories as separate series", () => {
    // The synthetic Uncategorized bucket (id 0) vs. a real category a user
    // happened to name "Uncategorized" — keyed by name these would merge and
    // one total would silently overwrite the other.
    const clashing: Category[] = [
      { id: 0, name: "Uncategorized", priority: -1 },
      { id: 7, name: "Uncategorized", priority: 3 },
    ];
    const [point] = pivotForRecharts(["2026-06-01"], clashing, [
      row(0, "2026-06-01", 10),
      row(7, "2026-06-01", 25),
    ]);
    expect(point).toEqual({ bucket: "2026-06-01", "0": 10, "7": 25 });
  });

  it("preserves bucket order", () => {
    const points = pivotForRecharts(["b", "a"], categories, []);
    expect(points.map((p) => p.bucket)).toEqual(["b", "a"]);
  });
});

describe("monthTransitionBuckets", () => {
  it("flags the first bucket of each new month", () => {
    expect(
      monthTransitionBuckets([
        "2026-01-30",
        "2026-01-31",
        "2026-02-01",
        "2026-02-02",
        "2026-03-01",
      ]),
    ).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("returns an empty array for 0 or 1 buckets", () => {
    expect(monthTransitionBuckets([])).toEqual([]);
    expect(monthTransitionBuckets(["2026-01-01"])).toEqual([]);
  });

  it("returns nothing when all buckets share a month", () => {
    expect(monthTransitionBuckets(["2026-01-01", "2026-01-02"])).toEqual([]);
  });
});
