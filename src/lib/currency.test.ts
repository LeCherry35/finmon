import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/db", () => ({ pool: { query } }));

import { CurrencyError, convert, convertScanToBase, getRate, toBase } from "@/lib/currency";
import type { ScanResult } from "@/lib/receipt-scan";

const fetchMock = vi.fn();

/** The exchange_rates cache: what the "latest on or before" SELECT returns. */
function cache(row: { rate: string; date: string } | null) {
  query.mockImplementation(async (sql: string) =>
    /SELECT rate, date FROM exchange_rates/.test(sql) ? { rows: row ? [row] : [] } : { rowCount: 1 },
  );
}

const nbu = (rate: number, date: string, cc = "USD") => ({
  ok: true,
  json: async () => [{ r030: 840, txt: "Долар США", rate, cc, exchangedate: date }],
});

beforeEach(() => {
  query.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getRate", () => {
  it("is 1 for UAH without touching the cache or the network", async () => {
    expect(await getRate("UAH", "2026-06-01")).toEqual({ rate: 1, date: "2026-06-01" });
    expect(query).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a cached rate for that exact day", async () => {
    cache({ rate: "41.5", date: "2026-06-01" });
    expect(await getRate("USD", "2026-06-01")).toEqual({ rate: 41.5, date: "2026-06-01" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches the NBU rate on a cache miss and caches it", async () => {
    cache(null);
    fetchMock.mockResolvedValueOnce(nbu(41.52, "01.06.2026"));

    expect(await getRate("USD", "2026-06-01")).toEqual({ rate: 41.52, date: "2026-06-01" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&date=20260601&json",
    );
    const insert = query.mock.calls.find(([sql]) => /INSERT INTO exchange_rates/.test(sql));
    expect(insert![1]).toEqual(["USD", "2026-06-01", 41.52]);
  });

  it("falls back to the latest earlier cached rate when the NBU is down", async () => {
    cache({ rate: "41", date: "2026-05-30" });
    fetchMock.mockRejectedValueOnce(new Error("network"));
    expect(await getRate("USD", "2026-06-01")).toEqual({ rate: 41, date: "2026-05-30" });
  });

  it("uses the current rate for a future date with nothing cached", async () => {
    cache(null);
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // no rate for that day yet
      .mockResolvedValueOnce(nbu(41.6, "14.10.2026"));
    expect(await getRate("USD", "2026-12-01")).toEqual({ rate: 41.6, date: "2026-10-14" });
    expect(fetchMock.mock.calls[1][0]).not.toMatch(/date=/);
  });

  it("throws a CurrencyError when no rate can be found at all", async () => {
    cache(null);
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(getRate("EUR", "2026-06-01")).rejects.toBeInstanceOf(CurrencyError);
  });
});

describe("conversion", () => {
  it("toBase rounds the UAH figure to cents", async () => {
    cache({ rate: "41.5234", date: "2026-06-01" });
    expect(await toBase(10.01, "USD", "2026-06-01")).toEqual({ amount: 415.65, rate: 41.5234 });
  });

  it("convert crosses currencies via UAH", async () => {
    query.mockImplementation(async (_sql: string, [currency]: string[]) => ({
      rows: [{ rate: currency === "USD" ? "40" : "50", date: "2026-06-01" }],
    }));
    expect(await convert(100, "EUR", "USD", "2026-06-01")).toEqual({
      result: 125,
      rate_date: "2026-06-01",
      uah_per_unit: { EUR: 50, USD: 40 },
    });
    expect(await convert(100, "UAH", "USD", "2026-06-01")).toMatchObject({ result: 2.5, uah_per_unit: { USD: 40 } });
  });

  const scan: ScanResult = {
    store: "Shop",
    total: 3,
    date: null,
    category: null,
    products: [
      { name: "Tea", brand: null, cost: 3, product_type: null, tags: [], description: null, price: 1.5, amount: 2, unit: "pcs", discount: null },
    ],
  };

  it("convertScanToBase leaves a UAH (or pre-currency) scan untouched", async () => {
    expect(await convertScanToBase(scan, "2026-06-01")).toEqual({
      scan,
      currency: "UAH",
      original_total: null,
      rate: null,
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("convertScanToBase converts every money figure of a foreign scan", async () => {
    cache({ rate: "40", date: "2026-06-01" });
    const out = await convertScanToBase({ ...scan, currency: "USD" }, "2026-06-01");
    expect(out.currency).toBe("USD");
    expect(out.original_total).toBe(3);
    expect(out.rate).toBe(40);
    expect(out.scan.total).toBe(120);
    expect(out.scan.currency).toBe("UAH");
    expect(out.scan.products[0]).toMatchObject({ cost: 120, price: 60, amount: 2, discount: null });
  });
});
