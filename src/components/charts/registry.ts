export type ChartId = "expenditures-over-time" | "category-share";

export const CHARTS: { id: ChartId; label: string }[] = [
  { id: "expenditures-over-time", label: "Expenditures over time" },
  { id: "category-share", label: "Category share" },
];

export const DEFAULT_CHART: ChartId = "expenditures-over-time";
