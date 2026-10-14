import "server-only";
import { z } from "zod";
import { pool } from "@/db";
import { BASE_CURRENCY, type Currency } from "@/lib/currencies";
import type { ScanResult } from "@/lib/receipt-scan";

// Conversion to the UAH base at the National Bank of Ukraine's official rate for
// a given day. Rates are cached in `exchange_rates` (migration 025): an official
// rate never changes once published, so each currency/day is fetched once.

/** A rate couldn't be found — surfaced to the user as-is. */
export class CurrencyError extends Error {}

const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange";
const REQUEST_TIMEOUT_MS = 10_000;

const NbuSchema = z.array(z.object({ cc: z.string(), rate: z.number().positive(), exchangedate: z.string() }));

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** dd.mm.yyyy → yyyy-mm-dd */
const fromNbuDate = (d: string) => d.split(".").reverse().join("-");

/** The NBU rate for `date` (yyyy-mm-dd), or today's when `date` is null. Null
 *  when the NBU has none for that day (a future date). Throws on network errors. */
async function fetchNbu(currency: Currency, date: string | null): Promise<{ rate: number; date: string } | null> {
  const params = new URLSearchParams({ valcode: currency });
  if (date) params.set("date", date.replaceAll("-", ""));
  const res = await fetch(`${NBU_URL}?${params}&json`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`NBU request failed (${res.status})`);
  const row = NbuSchema.parse(await res.json()).find((r) => r.cc === currency);
  return row ? { rate: row.rate, date: fromNbuDate(row.exchangedate) } : null;
}

async function cacheRate(currency: Currency, r: { rate: number; date: string }) {
  await pool.query(
    "INSERT INTO exchange_rates (currency, date, rate) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
    [currency, r.date, r.rate],
  );
}

/** UAH per 1 `currency` on `date`, plus the day that rate is actually for: the
 *  same day normally, an earlier one when the NBU can't serve `date` (a future
 *  date, or the NBU is unreachable). */
export async function getRate(currency: Currency, date: string): Promise<{ rate: number; date: string }> {
  if (currency === BASE_CURRENCY) return { rate: 1, date };

  const latestCached = async () => {
    const { rows } = await pool.query<{ rate: string; date: string }>(
      "SELECT rate, date FROM exchange_rates WHERE currency = $1 AND date <= $2 ORDER BY date DESC LIMIT 1",
      [currency, date],
    );
    return rows[0] ? { rate: Number(rows[0].rate), date: rows[0].date } : null;
  };

  const cached = await latestCached();
  if (cached?.date === date) return cached;

  try {
    const fetched = await fetchNbu(currency, date);
    if (fetched) {
      await cacheRate(currency, { rate: fetched.rate, date });
      return { rate: fetched.rate, date };
    }
  } catch (err) {
    console.warn(`NBU ${currency} rate for ${date} unavailable:`, err instanceof Error ? err.message : err);
  }
  if (cached) return cached;

  // Nothing on or before `date` (e.g. a future date and an empty cache): the
  // current rate is the best estimate.
  try {
    const current = await fetchNbu(currency, null);
    if (current) {
      await cacheRate(currency, current);
      return current;
    }
  } catch (err) {
    console.warn(`NBU current ${currency} rate unavailable:`, err instanceof Error ? err.message : err);
  }
  throw new CurrencyError(`Couldn't get the ${currency} exchange rate — try again or enter the amount in UAH`);
}

/** `amount` of `currency` in UAH on `date`. */
export async function toBase(amount: number, currency: Currency, date: string): Promise<{ amount: number; rate: number }> {
  const { rate } = await getRate(currency, date);
  return { amount: round2(amount * rate), rate };
}

/** Convert between any two supported currencies (via UAH). */
export async function convert(amount: number, from: Currency, to: Currency, date: string) {
  const [a, b] = await Promise.all([getRate(from, date), getRate(to, date)]);
  return {
    result: round2((amount * a.rate) / b.rate),
    // The day the rates are for (the earlier one if they differ).
    rate_date: a.date < b.date ? a.date : b.date,
    uah_per_unit: Object.fromEntries(
      [from, to].filter((c) => c !== BASE_CURRENCY).map((c) => [c, c === from ? a.rate : b.rate]),
    ),
  };
}

/** A scan with every money figure (total, product cost/price/discount) in UAH,
 *  plus what the receipt actually printed. A scan from before currencies existed
 *  has no `currency` and is UAH. */
export async function convertScanToBase(
  scan: ScanResult,
  date: string,
): Promise<{ scan: ScanResult; currency: Currency; original_total: number | null; rate: number | null }> {
  const currency = scan.currency ?? BASE_CURRENCY;
  if (currency === BASE_CURRENCY) return { scan, currency, original_total: null, rate: null };
  const { rate } = await getRate(currency, date);
  const conv = (n: number | null) => (n === null ? null : round2(n * rate));
  return {
    scan: {
      ...scan,
      currency: BASE_CURRENCY,
      total: conv(scan.total),
      products: scan.products.map((p) => ({ ...p, cost: conv(p.cost), price: conv(p.price), discount: conv(p.discount) })),
    },
    currency,
    original_total: scan.total,
    rate,
  };
}
