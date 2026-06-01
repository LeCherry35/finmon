import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bucketMonth,
  categoryColor,
  formatBucketLabel,
  formatMonthLabelShort,
  generateBuckets,
  pickBucket,
} from "@/lib/charts";

// Pin "today" well past every selected month so the current-month tail-trim
// never fires — these assertions then depend only on calendar month lengths,
// which are timezone-independent.
function freezeFuture() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-15T12:00:00Z"));
}

afterEach(() => vi.useRealTimers());

describe("pickBucket", () => {
  it("uses day buckets for <= 180 visible days", () => {
    freezeFuture();
    // Jan–May 2026 = 31+28+31+30+31 = 151 days
    expect(
      pickBucket(["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]),
    ).toBe("day");
  });

  it("uses month buckets past 180 visible days", () => {
    freezeFuture();
    // Jan–Jun 2026 = 151 + 30 = 181 days
    expect(
      pickBucket([
        "2026-01",
        "2026-02",
        "2026-03",
        "2026-04",
        "2026-05",
        "2026-06",
      ]),
    ).toBe("month");
  });

  it("ignores malformed months when counting days", () => {
    freezeFuture();
    expect(pickBucket(["2026-01", "garbage"])).toBe("day");
  });
});

describe("generateBuckets", () => {
  it("returns one day key per calendar day for a past month", () => {
    freezeFuture();
    const buckets = generateBuckets(["2026-02"], "day");
    expect(buckets).toHaveLength(28);
    expect(buckets[0]).toBe("2026-02-01");
    expect(buckets.at(-1)).toBe("2026-02-28");
  });

  it("collapses to one key per month in month granularity", () => {
    freezeFuture();
    expect(generateBuckets(["2026-01", "2026-02"], "month")).toEqual([
      "2026-01",
      "2026-02",
    ]);
  });

  it("returns an empty array for no months", () => {
    expect(generateBuckets([], "day")).toEqual([]);
  });

  it("ignores malformed months", () => {
    freezeFuture();
    expect(generateBuckets(["bad", "2026-02"], "month")).toEqual(["2026-02"]);
  });

  it("trims the latest current month to today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const buckets = generateBuckets(["2026-06"], "day");
    expect(buckets[0]).toBe("2026-06-01");
    // Today is the 15th; tolerate a ±1 day timezone skew on the boundary.
    expect(buckets.length).toBeGreaterThanOrEqual(14);
    expect(buckets.length).toBeLessThanOrEqual(15);
    expect(buckets.every((b) => b <= "2026-06-15")).toBe(true);
  });

  it("does not trim a past month even when another month is current", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    const buckets = generateBuckets(["2026-05", "2026-06"], "day");
    expect(buckets).toContain("2026-05-31"); // May not trimmed
  });
});

describe("bucketMonth", () => {
  it("validates month keys in month granularity", () => {
    expect(bucketMonth("2026-06", "month")).toBe("2026-06");
    expect(bucketMonth("2026-06-01", "month")).toBeNull();
  });

  it("slices the month out of a day key", () => {
    expect(bucketMonth("2026-06-15", "day")).toBe("2026-06");
    expect(bucketMonth("2026-06", "day")).toBeNull();
  });
});

describe("formatBucketLabel", () => {
  it("formats month and day keys", () => {
    expect(formatBucketLabel("2026-06", "month")).toBe("Jun 26");
    expect(formatBucketLabel("2026-06-15", "day")).toBe("Jun 15");
  });

  it("returns malformed keys unchanged", () => {
    expect(formatBucketLabel("nope", "month")).toBe("nope");
    expect(formatBucketLabel("nope", "day")).toBe("nope");
  });
});

describe("formatMonthLabelShort", () => {
  it("formats a valid month with a 2-digit year", () => {
    expect(formatMonthLabelShort("2026-06")).toBe("Jun 26");
  });

  it("returns malformed input unchanged", () => {
    expect(formatMonthLabelShort("nope")).toBe("nope");
  });
});

describe("categoryColor", () => {
  it("derives a deterministic hue from the id", () => {
    expect(categoryColor(0)).toEqual({
      fill: "hsl(0 60% 70% / 0.85)",
      stroke: "hsl(0 55% 45%)",
    });
    expect(categoryColor(1).fill).toBe("hsl(137.508 60% 70% / 0.85)");
  });

  it("is stable across calls", () => {
    expect(categoryColor(7)).toEqual(categoryColor(7));
  });
});
