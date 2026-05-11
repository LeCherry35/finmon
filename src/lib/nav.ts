export const NAV_LINKS = [
  { href: "/transactions", label: "Transactions", short: "Log" },
  { href: "/categories", label: "Categories", short: "Cats" },
  { href: "/expenditures", label: "Expenditures", short: "Spend" },
  { href: "/plan", label: "Plan", short: "Plan" },
  { href: "/charts", label: "Charts", short: "Charts" },
] as const;

export type NavHref = (typeof NAV_LINKS)[number]["href"];
