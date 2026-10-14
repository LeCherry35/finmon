// Client-safe currency constants (no `pg` import — see src/lib/categories.ts for
// why that matters). Conversion itself lives in src/lib/currency.ts.

/** Currencies a transaction can be entered in. Every stored amount is UAH. */
export const CURRENCIES = ["UAH", "USD", "EUR"] as const;
export type Currency = (typeof CURRENCIES)[number];
export const BASE_CURRENCY: Currency = "UAH";

export const CURRENCY_SYMBOL: Record<Currency, string> = { UAH: "₴", USD: "$", EUR: "€" };

export function isCurrency(v: unknown): v is Currency {
  return typeof v === "string" && (CURRENCIES as readonly string[]).includes(v);
}

/** "$25.00 @ 41.52" — a foreign original next to its UAH figure. */
export function originalLabel(amount: number, currency: Currency, rate: number | null): string {
  return `${CURRENCY_SYMBOL[currency]}${amount.toFixed(2)}${rate ? ` @ ${rate.toFixed(2)}` : ""}`;
}
