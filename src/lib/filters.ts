export const MONTH_RE = /^\d{4}-\d{2}$/;

export type Filters = {
  months: string[] | "default";
  categoryIds: number[] | "all";
};

export type ResolvedFilters = {
  months: string[];
  categoryIds: number[] | null;
};

export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function splitParam(v: string | string[] | undefined): string[] | null {
  if (v === undefined) return null;
  const raw = Array.isArray(v) ? v.join(",") : v;
  if (raw === "") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): Filters {
  const monthsRaw = splitParam(sp.months);
  const months: Filters["months"] =
    monthsRaw === null
      ? "default"
      : monthsRaw.filter((m) => MONTH_RE.test(m));

  const idsRaw = splitParam(sp.categories);
  let categoryIds: Filters["categoryIds"];
  if (idsRaw === null) {
    categoryIds = "all";
  } else {
    categoryIds = idsRaw
      .map((s) => Number(s))
      .filter((n) => Number.isInteger(n) && n > 0);
  }

  return { months, categoryIds };
}

export function resolveFilters(f: Filters): ResolvedFilters {
  const months = f.months === "default" ? [currentMonth()] : f.months;
  const categoryIds = f.categoryIds === "all" ? null : f.categoryIds;
  return { months, categoryIds };
}

export function buildFilterQuery(
  months: string[] | "default",
  categoryIds: number[] | "all",
): string {
  const parts: string[] = [];
  if (months !== "default") parts.push(`months=${months.join(",")}`);
  if (categoryIds !== "all") parts.push(`categories=${categoryIds.join(",")}`);
  return parts.length === 0 ? "" : `?${parts.join("&")}`;
}

export function formatMonthLabel(month: string): string {
  if (!MONTH_RE.test(month)) return month;
  const [y, m] = month.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}

export function summarizeFilters(
  f: Filters,
  allCategoriesCount: number,
): string {
  const monthPart =
    f.months === "default"
      ? formatMonthLabel(currentMonth())
      : f.months.length === 0
        ? "No months"
        : f.months.length === 1
          ? formatMonthLabel(f.months[0])
          : `${f.months.length} months`;

  const catPart =
    f.categoryIds === "all"
      ? "All"
      : f.categoryIds.length === 0
        ? "No categories"
        : f.categoryIds.length === allCategoriesCount
          ? "All"
          : `${f.categoryIds.length} categories`;

  return `${monthPart} · ${catPart}`;
}
