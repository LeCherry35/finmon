import { MONTH_RE } from "@/lib/filters";

export type Bucket = "day" | "month";

function lastDayOfMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

function todayUTC(): number {
  const now = new Date();
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function isLatestCurrentMonth(monthKey: string, sortedMonths: string[]): boolean {
  if (sortedMonths.length === 0) return false;
  const last = sortedMonths[sortedMonths.length - 1];
  return monthKey === last && monthKey === currentMonthKey();
}

function lastIncludedDay(monthKey: string, sortedMonths: string[]): number {
  const [y, mm] = monthKey.split("-").map(Number);
  if (!isLatestCurrentMonth(monthKey, sortedMonths)) {
    return lastDayOfMonth(y, mm);
  }
  const today = new Date(todayUTC());
  return today.getUTCFullYear() === y && today.getUTCMonth() + 1 === mm
    ? today.getUTCDate()
    : lastDayOfMonth(y, mm);
}

function visibleDayCount(months: string[]): number {
  const valid = months.filter((m) => MONTH_RE.test(m));
  const sorted = [...valid].sort();
  let count = 0;
  for (const m of sorted) count += lastIncludedDay(m, sorted);
  return count;
}

export function pickBucket(months: string[]): Bucket {
  const days = visibleDayCount(months);
  if (days <= 180) return "day";
  return "month";
}

function bucketKeyForDate(date: Date, bucket: Bucket): string {
  if (bucket === "day") return date.toISOString().slice(0, 10);
  return date.toISOString().slice(0, 7);
}

export function generateBuckets(months: string[], bucket: Bucket): string[] {
  if (months.length === 0) return [];
  const valid = months.filter((m) => MONTH_RE.test(m));
  const sorted = [...valid].sort();
  const set = new Set<string>();
  for (const m of sorted) {
    const [y, mm] = m.split("-").map(Number);
    const last = lastIncludedDay(m, sorted);
    for (let d = 1; d <= last; d++) {
      set.add(bucketKeyForDate(new Date(Date.UTC(y, mm - 1, d)), bucket));
    }
  }
  return Array.from(set).sort();
}

export function bucketMonth(key: string, bucket: Bucket): string | null {
  if (bucket === "month") {
    return MONTH_RE.test(key) ? key : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  return key.slice(0, 7);
}

export function formatBucketLabel(key: string, bucket: Bucket): string {
  if (bucket === "month") {
    if (!MONTH_RE.test(key)) return key;
    const [y, m] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      timeZone: "UTC",
    });
  }
  return key;
}

export function formatMonthLabelShort(month: string): string {
  if (!MONTH_RE.test(month)) return month;
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

export function categoryColor(id: number): { fill: string; stroke: string } {
  const hue = (id * 137.508) % 360;
  return {
    fill: `hsl(${hue} 60% 70% / 0.85)`,
    stroke: `hsl(${hue} 55% 45%)`,
  };
}
